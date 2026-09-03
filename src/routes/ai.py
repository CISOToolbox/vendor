"""Vendor (TPRM) AI endpoints.

The shared /api/ai proxy (provider registry, key/settings management,
/complete, /runtime, /config, /keys, /validate-key, the LLM dispatch) lives in
src/ai_proxy_common.py. Only the TPRM métier prompts and their suggestion /
collection endpoints are here — the methodology stays server-side.
"""
from __future__ import annotations

import json

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai_proxy_common import (
    _REFUSAL_HINT,
    _check_ai_access,
    _check_rate_limit,
    _parse_lax_or_refuse,
    _provider_complete,
    _runtime_provider_model,
    make_ai_router,
)
from src.auth import get_current_user
from src.database import get_db
from src.ai_prompts import (MAX_JSON, SCHEMA_ACTION, bloc_mesures, borner,
                            borner_liste, measure_context, validate_output)
from src.models import User
from src.routes.auth_helpers import get_project_or_404

# Common /api/ai endpoints; the métier endpoints below are appended to it.
router = make_ai_router(generic_complete=False)


def _lang_name(language: str) -> str:
    return "English" if (language or "fr").lower().startswith("en") else "French"


# ── Feature: suggest measures for a vendor or a vendor risk ────────────

class MeasureSuggestRequest(BaseModel):
    # one of the three modes, picked by `mode`
    mode: str = "vendor"          # "vendor" | "risk" | "custom"
    language: str = "fr"
    vendor_name: str = ""
    vendor_sector: str = ""
    vendor_services: str = ""
    classification: dict = {}
    exposure: dict = {}
    tier: str = ""
    dora_critical: bool = False
    gdpr_subprocessor: bool = False
    # FEAT-40 — le serveur lit les mesures du fournisseur EN BASE. Le client
    # envoyait des NOMS seuls, sans id ni description : le modèle ne pouvait
    # ni juger d'un recouvrement, ni désigner une mesure à enrichir.
    project_id: str = ""
    vendor_id: str = ""
    include_existing_measures: bool = True
    # risk context (mode "risk" / "custom")
    risk: dict = {}
    # custom request (mode "custom")
    custom_request: str = ""


def _measure_suggest_system(mode: str, vendor_name: str, language: str,
                            avec_mesures: bool = False) -> str:
    name = vendor_name or "Vendor"
    lang = _lang_name(language)
    # Le discriminant n'est demandé QUE si le plan est transmis : sans lui, le
    # modèle inventerait des identifiants de mesures qu'il n'a jamais vues.
    action = SCHEMA_ACTION if avec_mesures else ""
    schema = (
        '[{' + action + '"mesure":"SHORT name max 8 words — ' + name + '","details":"DETAILED '
        'implementation steps, procedures, tools, frequency, responsible teams '
        '(2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|'
        'Surveillance","responsable":"suggested owner"}]'
    )
    base = (
        "You are a third-party risk management expert. "
        f"IMPORTANT: always include the vendor name '{vendor_name}' in each measure name. "
        "Respond ONLY with valid JSON: " + schema + " Respond in " + lang + "."
    )
    if mode == "vendor":
        return (
            "You are a third-party risk management expert. Propose measures to mitigate "
            "VENDOR-SPECIFIC risks. Vendor risks = risks inherent to the vendor relationship "
            "(data breach at vendor, compliance loss, vendor lock-in, subcontractor failure, "
            "SLA violation, data sovereignty). NOT generic IT risks (phishing, ransomware, "
            "insider threats — those belong in a risk assessment tool, not vendor management). "
            f"IMPORTANT: always include the vendor name '{vendor_name}' in each measure name. "
            "Respond ONLY with valid JSON: " + schema + " Respond in " + lang +
            ". Propose 3-5 measures."
        )
    if mode == "risk":
        return (
            "You are a third-party risk management expert. Propose 2-3 measures to mitigate a "
            "VENDOR-SPECIFIC risk. This risk is about the vendor relationship itself, not about "
            "generic IT threats. Measures should address the vendor's practices, contractual "
            "obligations, monitoring, or alternatives. "
            f"IMPORTANT: always include the vendor name '{vendor_name}' in each measure name. "
            "Respond ONLY with valid JSON: " + schema + " Respond in " + lang + "."
        )
    # custom
    return (
        "You are a third-party risk management expert. The user has a specific request about "
        "measures for a vendor risk. Propose measures that address the vendor relationship "
        "specifically. "
        f"IMPORTANT: include the vendor name '{vendor_name}' in measure names. "
        "Respond ONLY with valid JSON: " + schema + " Respond in " + lang + "."
    )


@router.post("/vendor/suggest-measures")
async def vendor_suggest_measures(body: MeasureSuggestRequest,
                                  user: User = Depends(get_current_user),
                                  db: AsyncSession = Depends(get_db)):
    """Suggest mitigation measures for a vendor (mode 'vendor'), for a specific
    vendor risk (mode 'risk'), or driven by a free-text user request (mode
    'custom'). Returns {"result": [ {mesure, details, type, responsable}, … ]}."""
    _check_ai_access(user)
    _check_rate_limit(str(user.id) if user else "anonymous")
    provider, model = await _runtime_provider_model(db)

    mode = body.mode if body.mode in ("vendor", "risk", "custom") else "vendor"

    # Contexte de mesures : lu en base, jamais reçu du client.
    contexte = None
    if body.include_existing_measures and body.project_id and body.vendor_id:
        try:
            project = await get_project_or_404(body.project_id, user, db, "read")
        except HTTPException:
            raise
        contexte = await measure_context(db, project.id, body.vendor_id)
    bloc = bloc_mesures(contexte)

    if mode == "vendor":
        user_prompt = (
            "Vendor: " + json.dumps({
                "name": borner(body.vendor_name), "sector": borner(body.vendor_sector),
                "services": borner(body.vendor_services),
            }, ensure_ascii=False) +
            "\nExposure: " + json.dumps(body.exposure or {}, ensure_ascii=False)[:MAX_JSON] +
            "\nRisks: " + json.dumps(body.risk or {}, ensure_ascii=False)[:MAX_JSON] +
            bloc +
            "\nClassification: " + json.dumps(body.classification or {}, ensure_ascii=False)[:MAX_JSON] +
            "\nTier: " + borner(body.tier, 60) +
            ("\nDORA critical ICT provider: yes" if body.dora_critical else "") +
            ("\nGDPR subprocessor: yes" if body.gdpr_subprocessor else "")
        )
    elif mode == "risk":
        user_prompt = (
            "Vendor: " + borner(body.vendor_name) + " (" + borner(body.vendor_sector) + ")" +
            "\nRisk to mitigate: " + json.dumps(body.risk or {}, ensure_ascii=False)[:MAX_JSON] +
            bloc
        )
    else:  # custom
        user_prompt = (
            "Vendor: " + borner(body.vendor_name) +
            "\nRisk: " + json.dumps(body.risk or {}, ensure_ascii=False)[:MAX_JSON] +
            "\nUser request: " + borner(body.custom_request) +
            # Le mode `custom` n'en recevait AUCUNE : il produisait des doublons
            # à chaque demande libre.
            bloc
        )

    system = _measure_suggest_system(mode, borner(body.vendor_name, 200), body.language,
                                     contexte is not None)
    raw = await _provider_complete(db, system + _REFUSAL_HINT, user_prompt, provider, model)
    try:
        return {"result": validate_output(_parse_lax_or_refuse(raw), "measures")}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"unusable AI response: {e}")


# ── Feature: suggest client risks (with measures) for a vendor ─────────

class RiskSuggestRequest(BaseModel):
    mode: str = "auto"            # "auto" | "custom"
    language: str = "fr"
    vendor_name: str = ""
    vendor_sector: str = ""
    vendor_services: str = ""
    vendor_website: str = ""
    classification: dict = {}
    tier: str = ""
    dora_critical: bool = False
    gdpr_subprocessor: bool = False
    existing_risks: list[str] = []
    custom_request: str = ""
    # FEAT-40 — ce point d'entrée propose des risques AVEC leurs mesures.
    project_id: str = ""
    vendor_id: str = ""
    include_existing_measures: bool = True


def _risk_suggest_system(mode: str, vendor_name: str, language: str,
                         avec_mesures: bool = False) -> str:
    name = vendor_name or "Vendor"
    lang = _lang_name(language)
    schema = (
        '[{"title":"client risk (consequence)","category":"CYBER|OPS|FIN|COMP|'
        'STRAT|REP|GEO","impact":1-5,"likelihood":1-5,"description":"explain how '
        'this vendor situation creates risk for the client","measures":[{'
        + (SCHEMA_ACTION if avec_mesures else "") +
        '"mesure":"SHORT name max 8 words — ' + name + '","details":"DETAILED implementation '
        'steps (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|'
        'Surveillance","responsable":"owner"}]}]'
    )
    if mode == "custom":
        return (
            "You are a third-party risk management expert. The user has a specific request "
            "about vendor risks. FOCUS ON CLIENT IMPACT: each risk must describe a concrete "
            "negative consequence FOR THE CLIENT'S ORGANIZATION if something goes wrong with "
            "this vendor. "
            "GOOD risk titles: 'Patient data breach via vendor compromise', 'Production "
            "downtime due to vendor SLA failure', 'Regulatory fine due to vendor "
            "non-compliance with GDPR'. "
            "BAD risk titles (do NOT use): 'Vendor lacks ISO 27001', 'Weak access controls "
            "at vendor', 'No MFA at vendor' — these are vendor WEAKNESSES, not risks for the "
            "client. A weakness becomes a risk only when you describe its IMPACT on the client. "
            f"IMPORTANT: include the vendor name '{vendor_name}' in measure names. "
            "Respond ONLY with valid JSON: " + schema + " Respond in " + lang + "."
        )
    return (
        "You are a third-party risk management expert. Analyze the vendor and propose risks "
        "FOR THE CLIENT caused by using this vendor's services. "
        "FOCUS ON CLIENT IMPACT: each risk must describe what could go wrong for the CLIENT "
        "(not the vendor's internal weaknesses). "
        "GOOD risk examples: 'Patient data exposure following vendor breach', 'Service "
        "interruption impacting production due to vendor outage', 'Regulatory sanction due "
        "to vendor GDPR non-compliance', 'Vendor lock-in preventing migration', 'Supply "
        "chain attack via vendor update mechanism'. "
        "BAD risk examples (do NOT suggest): 'Vendor lacks certifications', 'Weak vendor "
        "password policy', 'No MFA at vendor', 'Vendor has no SIEM' — these are vendor "
        "WEAKNESSES. Transform them into CLIENT RISKS by stating the consequence: 'Data "
        "breach risk due to weak vendor security controls'. "
        "Also BAD: generic IT threats (phishing, ransomware, DDoS) that are not specific to "
        "the vendor relationship. "
        f"IMPORTANT: include the vendor name '{vendor_name}' in each measure name. "
        "Respond ONLY with valid JSON: " + schema + " Respond in " + lang +
        ". Propose 2-4 risks with 1-2 measures each."
    )


@router.post("/vendor/suggest-risks")
async def vendor_suggest_risks(body: RiskSuggestRequest,
                               user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    """Suggest client-impact risks (each with mitigation measures) for a vendor.
    mode 'auto' analyses the vendor profile; mode 'custom' is driven by a
    free-text user request. Returns {"result": [ {title, category, impact,
    likelihood, description, measures[]}, … ]}."""
    _check_ai_access(user)
    _check_rate_limit(str(user.id) if user else "anonymous")
    provider, model = await _runtime_provider_model(db)

    # FEAT-40 — ce point d'entrée propose des risques AVEC leurs mesures : il
    # doit voir le plan comme les autres. `bloc` y était référencé sans être
    # calculé (NameError au premier appel en mode personnalisé).
    contexte = None
    if body.include_existing_measures and body.project_id and body.vendor_id:
        project = await get_project_or_404(body.project_id, user, db, "read")
        contexte = await measure_context(db, project.id, body.vendor_id)
    bloc = bloc_mesures(contexte)

    mode = "custom" if body.mode == "custom" else "auto"
    if mode == "custom":
        user_prompt = (
            "Vendor: " + borner(body.vendor_name) + " (" + borner(body.vendor_sector) + ")" +
            "\nServices: " + borner(body.vendor_services) +
            "\nUser request: " + borner(body.custom_request) +
            # Le mode `custom` n'en recevait AUCUNE : il produisait des doublons
            # à chaque demande libre.
            bloc
        )
    else:
        user_prompt = (
            "Vendor: " + json.dumps({
                "name": borner(body.vendor_name), "sector": borner(body.vendor_sector),
                "services": borner(body.vendor_services), "website": borner(body.vendor_website),
            }, ensure_ascii=False) +
            "\nClassification: " + json.dumps(body.classification or {}, ensure_ascii=False)[:MAX_JSON] +
            "\nTier: " + borner(body.tier, 60) +
            ("\nDORA critical ICT provider: yes" if body.dora_critical else "") +
            ("\nGDPR subprocessor: yes" if body.gdpr_subprocessor else "") +
            "\nExisting risks: " + (", ".join(borner_liste(body.existing_risks)) or "none") +
            # Chaque branche joint `bloc` EXPLICITEMENT. L'ancien garde-fou
            # (`if "Existing measures" not in user_prompt`) décidait sur une
            # sous-chaîne d'un texte partiellement contrôlé par le client :
            # un champ contenant ces mots supprimait le contexte en silence.
            bloc
        )
    system = _risk_suggest_system(mode, borner(body.vendor_name, 200), body.language,
                                  contexte is not None)
    raw = await _provider_complete(db, system + _REFUSAL_HINT, user_prompt, provider, model)
    try:
        return {"result": validate_output(_parse_lax_or_refuse(raw), "risks")}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"unusable AI response: {e}")


# ── Feature: suggest assessment answers for a questionnaire domain ─────

class AssessmentQuestion(BaseModel):
    id: str = ""
    text: str = ""


class AssessmentSuggestRequest(BaseModel):
    language: str = "fr"
    vendor_name: str = ""
    vendor_sector: str = ""
    vendor_website: str = ""
    certifications: list = []
    questions: list[AssessmentQuestion] = []


@router.post("/vendor/suggest-assessment")
async def vendor_suggest_assessment(body: AssessmentSuggestRequest,
                                    user: User = Depends(get_current_user),
                                    db: AsyncSession = Depends(get_db)):
    """Suggest answers for a set of security-assessment questions, based on
    public information about the vendor. Returns {"result": [ {question_id,
    answer, comment}, … ]}."""
    _check_ai_access(user)
    _check_rate_limit(str(user.id) if user else "anonymous")
    provider, model = await _runtime_provider_model(db)

    lang = _lang_name(body.language)
    system = (
        "You are a third-party security assessor. Based on public information about the "
        "vendor, suggest answers for these security assessment questions. Respond in " +
        lang + ". Return valid JSON: "
        '[{"question_id":"Q01","answer":"compliant|partial|non_compliant|na",'
        '"comment":"justification"}]'
    )
    user_prompt = (
        "Vendor: " + json.dumps({
            "name": body.vendor_name, "sector": body.vendor_sector,
            "website": body.vendor_website, "certifications": body.certifications,
        }, ensure_ascii=False) +
        "\nQuestions to assess:\n" +
        "\n".join((q.id or "") + ": " + (q.text or "") for q in body.questions)
    )
    raw = await _provider_complete(db, system + _REFUSAL_HINT, user_prompt, provider, model)
    try:
        return {"result": validate_output(_parse_lax_or_refuse(raw), "assessment")}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"unusable AI response: {e}")


# ── Feature: collect a vendor profile from public knowledge ────────────

class CollectInfoRequest(BaseModel):
    language: str = "fr"
    vendor_name: str = ""
    vendor_website: str = ""
    vendor_sector: str = ""
    vendor_services: str = ""


def _collect_info_system(language: str) -> str:
    base = (
        "Tu es un expert en securite et gestion des risques tiers (TPRM). "
        "On te donne le nom et/ou le site web d'un fournisseur. "
        "Recherche et rassemble un maximum d'informations sur ce fournisseur. "
        "Pour chaque certification ou document de conformite, fournis l'URL publique si elle "
        "existe (page trust/security du fournisseur, portail de conformite, registre de "
        "certification). "
        "Reponds UNIQUEMENT en JSON valide avec cette structure :\n"
        '{\n'
        '  "legal_entity": "nom legal complet",\n'
        '  "country": "code pays (FR, US, DE...)",\n'
        '  "sector": "secteur d\'activite",\n'
        '  "website": "url du site",\n'
        '  "services": "description des services principaux",\n'
        '  "certifications": ["ISO 27001", "SOC 2 Type II", ...],\n'
        '  "public_docs": [\n'
        '    {"name": "Page Trust / Security", "url": "https://...", "type": "trust_center"},\n'
        '    {"name": "SOC 2 Type II Report", "url": "https://...", "type": "audit_report"},\n'
        '    {"name": "ISO 27001 Certificate", "url": "https://...", "type": "certification"},\n'
        '    {"name": "Data Processing Agreement", "url": "https://...", "type": "dpa"},\n'
        '    {"name": "Privacy Policy", "url": "https://...", "type": "privacy"},\n'
        '    {"name": "Security Whitepaper", "url": "https://...", "type": "whitepaper"},\n'
        '    {"name": "Status Page", "url": "https://...", "type": "status_page"},\n'
        '    {"name": "Bug Bounty / Responsible Disclosure", "url": "https://...", "type": "bug_bounty"}\n'
        '  ],\n'
        '  "dpa_available": true/false,\n'
        '  "data_location": "UE/US/Global",\n'
        '  "known_incidents": "incidents de securite connus ou null",\n'
        '  "sub_contractors": ["principaux sous-traitants connus"],\n'
        '  "security_assessment": {\n'
        '    "governance": "compliant/partial/non_compliant/unknown",\n'
        '    "access_management": "...",\n'
        '    "privileged_access": "...",\n'
        '    "vulnerability_mgmt": "...",\n'
        '    "dev_security": "...",\n'
        '    "data_protection": "...",\n'
        '    "endpoint_protection": "...",\n'
        '    "continuity": "...",\n'
        '    "supply_chain": "...",\n'
        '    "audit": "..."\n'
        '  },\n'
        '  "risks": [\n'
        '    {"title": "...", "category": "CYBER/OPS/FIN/COMP/STRAT/REP/GEO", "impact": 1-5, "likelihood": 1-5, "description": "..."}\n'
        '  ],\n'
        '  "notes": "autres informations pertinentes"\n'
        '}\n\n'
        "IMPORTANT pour public_docs : ne fournis QUE des URLs que tu connais reellement "
        "(pages trust center, portails de conformite, pages security du fournisseur). "
        "Ne fabrique pas d'URLs. Si tu ne connais pas l'URL exacte, omets l'entree. "
        "Les types possibles sont : trust_center, audit_report, certification, dpa, privacy, "
        "whitepaper, status_page, bug_bounty.\n\n"
        "Base-toi sur tes connaissances de cette entreprise. "
        "Si tu ne connais pas une information, mets null ou unknown. "
        "JSON uniquement, pas de markdown."
    )
    if (language or "fr").lower().startswith("en"):
        base = (base
                .replace("Tu es un expert en securite et gestion des risques tiers (TPRM).",
                         "You are a security and third-party risk management (TPRM) expert.")
                .replace("On te donne le nom et/ou le site web d'un fournisseur.",
                         "You are given the name and/or website of a vendor.")
                .replace("Recherche et rassemble un maximum d'informations sur ce fournisseur.",
                         "Research and gather as much information as possible about this vendor.")
                .replace("Reponds UNIQUEMENT en JSON valide avec cette structure",
                         "Respond ONLY with valid JSON using this structure")
                .replace("Base-toi sur tes connaissances de cette entreprise.",
                         "Use your knowledge of this company.")
                .replace("Si tu ne connais pas une information, mets null ou unknown.",
                         "If you don't know something, use null or unknown.")
                .replace("JSON uniquement, pas de markdown.", "JSON only, no markdown."))
    return base


@router.post("/vendor/collect-info")
async def vendor_collect_info(body: CollectInfoRequest,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Collect a vendor profile (legal entity, certifications, public docs,
    security assessment, candidate risks) from the model's public knowledge.
    Returns {"result": { … the vendor profile object … }}."""
    _check_ai_access(user)
    _check_rate_limit(str(user.id) if user else "anonymous")
    provider, model = await _runtime_provider_model(db)

    is_en = (body.language or "fr").lower().startswith("en")
    query = body.vendor_name or ""
    if body.vendor_website:
        query += " (" + body.vendor_website + ")"
    if body.vendor_sector:
        query += " — " + body.vendor_sector
    if body.vendor_services:
        query += " — Services: " + body.vendor_services
    user_prompt = ("Vendor: " if is_en else "Fournisseur: ") + query

    system = _collect_info_system(body.language)
    raw = await _provider_complete(db, system + _REFUSAL_HINT, user_prompt, provider, model)
    try:
        return {"result": validate_output(_parse_lax_or_refuse(raw), "profile")}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"unusable AI response: {e}")


# ── Feature: find public security-documentation URLs for a vendor ──────

_DOC_TAXONOMY = [
    {"type": "trust_center", "label": "Trust Center / Security page"},
    {"type": "certification", "label": "ISO 27001 certificate"},
    {"type": "certification", "label": "SOC 2 Type II report"},
    {"type": "certification", "label": "HDS (Hebergeur de Donnees de Sante) certificate"},
    {"type": "certification", "label": "SecNumCloud qualification"},
    {"type": "certification", "label": "PCI DSS attestation"},
    {"type": "certification", "label": "CSA STAR listing"},
    {"type": "privacy", "label": "Privacy policy"},
    {"type": "dpa", "label": "Data Processing Agreement (DPA / GDPR)"},
    {"type": "dpa", "label": "Sub-processors list"},
    {"type": "status_page", "label": "Status page (uptime monitoring)"},
    {"type": "bug_bounty", "label": "Bug bounty / Responsible disclosure program"},
    {"type": "bug_bounty", "label": "security.txt (/.well-known/security.txt)"},
    {"type": "whitepaper", "label": "Security whitepaper / architecture overview"},
    {"type": "audit_report", "label": "Penetration test summary / third-party audit"},
]


class CollectDocsRequest(BaseModel):
    language: str = "fr"
    vendor_name: str = ""
    vendor_website: str = ""
    vendor_sector: str = ""
    existing_urls: list[str] = []


@router.post("/vendor/collect-docs")
async def vendor_collect_docs(body: CollectDocsRequest,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    """Find real, verified public URLs for a vendor's security documentation.
    Returns {"result": [ {name, type, url}, … ]}."""
    _check_ai_access(user)
    _check_rate_limit(str(user.id) if user else "anonymous")
    provider, model = await _runtime_provider_model(db)

    is_en = (body.language or "fr").lower().startswith("en")
    system = (
        "You are a TPRM documentation research expert. "
        "Your job is to find REAL, VERIFIED public URLs for vendor security documentation. "
        "You must ONLY return URLs you are certain exist. "
        "If you are not sure a URL exists, DO NOT include it. "
        "An empty array is better than fabricated URLs."
    )

    query = body.vendor_name or ""
    if body.vendor_website:
        query += " (" + body.vendor_website + ")"
    if body.vendor_sector:
        query += " — " + body.vendor_sector
    doc_list = "\n".join("- " + d["label"] + " (type: " + d["type"] + ")" for d in _DOC_TAXONOMY)
    existing = body.existing_urls or []

    user_prompt = (
        ("Vendor: " if is_en else "Fournisseur : ") + query + "\n\n" +
        ("Find the public URLs for each of these document types:\n" if is_en
         else "Trouve les URLs publiques pour chacun de ces types de documents :\n") +
        doc_list + "\n\n" +
        ((("Already found (do NOT repeat):\n" if is_en else "Deja trouves (NE PAS repeter) :\n")
          + "\n".join(existing) + "\n\n") if existing else "") +
        (("RULES:\n"
          "1. Only return URLs you KNOW exist (from your training data)\n"
          "2. Prefer official vendor domains over third-party sources\n"
          "3. Common patterns: /trust, /security, /privacy, /compliance, /dpa, status.domain.com\n"
          "4. For certifications, link to the vendor's compliance page, NOT the certifying body\n"
          "5. If the vendor has no public page for a document type, omit it\n\n")
         if is_en else
         ("REGLES :\n"
          "1. Ne retourne QUE des URLs que tu SAIS exister (depuis tes donnees d'entrainement)\n"
          "2. Privilegier les domaines officiels du fournisseur aux sources tierces\n"
          "3. Patterns courants : /trust, /security, /privacy, /compliance, /dpa, status.domaine.com\n"
          "4. Pour les certifications, lier la page compliance du fournisseur, PAS l'organisme certificateur\n"
          "5. Si le fournisseur n'a pas de page publique pour un type de document, ne l'inclus pas\n\n")) +
        "JSON array only, no markdown:\n"
        '[{"name": "Trust Center", "type": "trust_center", "url": "https://..."}, ...]'
    )

    raw = await _provider_complete(db, system + _REFUSAL_HINT, user_prompt, provider, model)
    parsed = _parse_lax_or_refuse(raw)
    docs = parsed if isinstance(parsed, list) else []
    return {"result": docs}
