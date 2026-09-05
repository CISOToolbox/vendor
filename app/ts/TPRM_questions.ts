/**
 * TPRM — Security questionnaire (25 essential + 5 DORA)
 * Covers: governance, access, network, dev, data, endpoints, detection,
 *         continuity, supply chain, audit, HR, physical, cloud, incidents, compliance
 */

var TPRM_QUESTIONS: TprmLegacyQuestion[] = [
    // ── Governance & organization ────────────────────────────────
    {
        id: "Q01", domain: "governance",
        text_fr: "Disposez-vous d'une politique de sécurité (PSSI) formalisée, approuvée par la direction et mise à jour annuellement ?",
        text_en: "Do you have a formal security policy (ISSP) approved by management and updated annually?",
        expected_fr: "PSSI signée par la direction, revue annuelle, diffusée à tous les collaborateurs.",
        expected_en: "ISSP signed by management, annual review, distributed to all employees.",
        red_flags_fr: "Pas de PSSI, pas de validation direction, document obsolète (>2 ans).",
        red_flags_en: "No ISSP, no management approval, outdated document (>2 years).",
        evidence_fr: "PSSI signée et datée, preuve de diffusion",
        evidence_en: "Signed and dated ISSP, distribution proof",
        weight: 10
    },
    {
        id: "Q02", domain: "governance",
        text_fr: "Réalisez-vous une analyse de risques formalisée et maintenue à jour ?",
        text_en: "Do you perform a formal and up-to-date risk analysis?",
        expected_fr: "Analyse de risques documentée (ISO 27005, EBIOS RM ou équivalent), revue annuelle, registre des risques maintenu.",
        expected_en: "Documented risk analysis (ISO 27005, EBIOS RM or equivalent), annual review, maintained risk register.",
        red_flags_fr: "Pas d'analyse de risques, méthodologie non reconnue, pas de registre.",
        red_flags_en: "No risk analysis, unrecognized methodology, no risk register.",
        evidence_fr: "Registre des risques, méthodologie utilisée, date de dernière revue",
        evidence_en: "Risk register, methodology used, date of last review",
        weight: 10
    },
    {
        id: "Q03", domain: "governance",
        text_fr: "Avez-vous un responsable sécurité (RSSI/CISO) identifié avec des responsabilités clairement définies ?",
        text_en: "Do you have an identified security officer (CISO) with clearly defined responsibilities?",
        expected_fr: "RSSI nommé, fiche de poste, rattachement direction, budget sécurité dédié.",
        expected_en: "Named CISO, job description, reports to management, dedicated security budget.",
        red_flags_fr: "Pas de RSSI, sécurité portée par l'IT sans mandat, pas de budget.",
        red_flags_en: "No CISO, security handled by IT without mandate, no budget.",
        evidence_fr: "Organigramme, fiche de poste RSSI, budget sécurité",
        evidence_en: "Organization chart, CISO job description, security budget",
        weight: 8
    },
    // ── Access management ────────────────────────────────────────
    {
        id: "Q04", domain: "access_management",
        text_fr: "Supportez-vous le SSO (SAML/OIDC) avec provisioning/deprovisioning automatique (SCIM) ?",
        text_en: "Do you support SSO (SAML/OIDC) with automatic provisioning/deprovisioning (SCIM)?",
        expected_fr: "SSO SAML 2.0 ou OIDC, provisioning SCIM, deprovisioning automatique à J+0.",
        expected_en: "SAML 2.0 or OIDC SSO, SCIM provisioning, automatic deprovisioning at D+0.",
        red_flags_fr: "Pas de SSO, comptes locaux uniquement, deprovisioning manuel.",
        red_flags_en: "No SSO, local accounts only, manual deprovisioning.",
        evidence_fr: "Documentation SSO, configuration SCIM, procédure de deprovisioning",
        evidence_en: "SSO documentation, SCIM config, deprovisioning procedure",
        weight: 10
    },
    {
        id: "Q05", domain: "access_management",
        text_fr: "Les accès privilégiés (admin) sont-ils protégés par MFA et tracés via un bastion/PAM ?",
        text_en: "Are privileged (admin) accesses protected by MFA and traced via bastion/PAM?",
        expected_fr: "MFA obligatoire, bastion/PAM pour tout accès admin, journalisation complète des sessions.",
        expected_en: "Mandatory MFA, bastion/PAM for all admin access, full session logging.",
        red_flags_fr: "Pas de MFA admin, accès direct production, comptes admin partagés.",
        red_flags_en: "No admin MFA, direct production access, shared admin accounts.",
        evidence_fr: "Politique MFA, architecture PAM, exemples de traces",
        evidence_en: "MFA policy, PAM architecture, sample audit logs",
        weight: 10
    },
    {
        id: "Q06", domain: "access_management",
        text_fr: "Réalisez-vous des revues d'accès périodiques (au minimum annuelles) ?",
        text_en: "Do you perform periodic access reviews (at least annually)?",
        expected_fr: "Revue annuelle des accès, validation par les managers, suppression des comptes inactifs.",
        expected_en: "Annual access review, manager validation, removal of inactive accounts.",
        red_flags_fr: "Pas de revue des accès, comptes orphelins, pas de processus de sortie.",
        red_flags_en: "No access reviews, orphaned accounts, no offboarding process.",
        evidence_fr: "Rapport de revue des accès, procédure de sortie collaborateur",
        evidence_en: "Access review report, employee offboarding procedure",
        weight: 8
    },
    // ── Network security ─────────────────────────────────────────
    {
        id: "Q07", domain: "network",
        text_fr: "Votre réseau est-il segmenté avec un filtrage entre zones (production, DMZ, management) ?",
        text_en: "Is your network segmented with filtering between zones (production, DMZ, management)?",
        expected_fr: "Segmentation réseau documentée, pare-feu entre zones, microsegmentation si cloud.",
        expected_en: "Documented network segmentation, firewalls between zones, microsegmentation if cloud.",
        red_flags_fr: "Réseau plat, pas de filtrage, accès direct Internet depuis la production.",
        red_flags_en: "Flat network, no filtering, direct Internet access from production.",
        evidence_fr: "Schéma réseau, matrice de flux, règles de pare-feu",
        evidence_en: "Network diagram, flow matrix, firewall rules",
        weight: 8
    },
    // ── Vulnerability management ─────────────────────────────────
    {
        id: "Q08", domain: "vulnerability_mgmt",
        text_fr: "Avez-vous un processus de patch management avec des SLA par sévérité ?",
        text_en: "Do you have a patch management process with SLAs by severity?",
        expected_fr: "Critique <24h, Haute <7j, Moyenne <30j, scans de vulnérabilités réguliers.",
        expected_en: "Critical <24h, High <7d, Medium <30d, regular vulnerability scans.",
        red_flags_fr: "Pas de SLA, pas de scans, patches appliqués « quand possible ».",
        red_flags_en: "No SLAs, no scans, patches applied 'when possible'.",
        evidence_fr: "Politique de patching, rapports de scan, métriques MTTR",
        evidence_en: "Patching policy, scan reports, MTTR metrics",
        weight: 10
    },
    {
        id: "Q09", domain: "vulnerability_mgmt",
        text_fr: "Disposez-vous d'un programme de bug bounty ou de tests d'intrusion réguliers ?",
        text_en: "Do you have a bug bounty program or regular penetration tests?",
        expected_fr: "Pentest annuel par un tiers indépendant, scope complet, plan de remédiation suivi.",
        expected_en: "Annual pentest by independent third party, full scope, tracked remediation plan.",
        red_flags_fr: "Pas de pentest, pentest interne uniquement, pas de suivi des corrections.",
        red_flags_en: "No pentest, internal pentest only, no remediation tracking.",
        evidence_fr: "Rapport de pentest récent, plan de remédiation, attestation de correction",
        evidence_en: "Recent pentest report, remediation plan, fix attestation",
        weight: 10
    },
    // ── Secure development ───────────────────────────────────────
    {
        id: "Q10", domain: "dev_security",
        text_fr: "Les environnements prod/dev/test sont-ils strictement isolés ? Les données prod sont-elles masquées en dev ?",
        text_en: "Are prod/dev/test environments strictly isolated? Is prod data masked in dev?",
        expected_fr: "Isolation stricte, données anonymisées en dev, revue de code systématique.",
        expected_en: "Strict isolation, anonymized data in dev, systematic code review.",
        red_flags_fr: "Données prod en dev, pas d'isolation, pas de revue de code.",
        red_flags_en: "Prod data in dev, no isolation, no code review.",
        evidence_fr: "Schéma des environnements, politique de masquage, pipeline CI/CD",
        evidence_en: "Environment diagram, masking policy, CI/CD pipeline",
        weight: 10
    },
    {
        id: "Q11", domain: "dev_security",
        text_fr: "Utilisez-vous des outils d'analyse de code (SAST/DAST/SCA) intégrés dans votre pipeline CI/CD ?",
        text_en: "Do you use code analysis tools (SAST/DAST/SCA) integrated in your CI/CD pipeline?",
        expected_fr: "SAST et SCA dans le pipeline CI, DAST en staging, politique de blocage sur vulnérabilités critiques.",
        expected_en: "SAST and SCA in CI pipeline, DAST on staging, blocking policy on critical vulnerabilities.",
        red_flags_fr: "Pas d'analyse de code automatisée, déploiement sans contrôle de sécurité.",
        red_flags_en: "No automated code analysis, deployment without security checks.",
        evidence_fr: "Configuration pipeline, rapports SAST/DAST, politique de seuils",
        evidence_en: "Pipeline config, SAST/DAST reports, threshold policy",
        weight: 8
    },
    // ── Data protection ──────────────────────────────────────────
    {
        id: "Q12", domain: "data_protection",
        text_fr: "Les données sont-elles chiffrées au repos (AES-256) et en transit (TLS 1.2+) ?",
        text_en: "Is data encrypted at rest (AES-256) and in transit (TLS 1.2+)?",
        expected_fr: "AES-256 at rest, TLS 1.2+ en transit, gestion des clés documentée.",
        expected_en: "AES-256 at rest, TLS 1.2+ in transit, documented key management.",
        red_flags_fr: "Pas de chiffrement at rest, TLS < 1.2, clés de chiffrement en dur dans le code.",
        red_flags_en: "No encryption at rest, TLS < 1.2, hardcoded encryption keys.",
        evidence_fr: "Attestation de chiffrement, scan TLS, procédure de gestion des clés",
        evidence_en: "Encryption attestation, TLS scan, key management procedure",
        weight: 10
    },
    {
        id: "Q13", domain: "data_protection",
        text_fr: "Êtes-vous en conformité RGPD (DPA signé, DPO nommé, registre des traitements, localisation UE) ?",
        text_en: "Are you GDPR compliant (signed DPA, appointed DPO, processing register, EU data location)?",
        expected_fr: "DPA signé, DPO nommé, registre des traitements à jour, données hébergées en UE.",
        expected_en: "Signed DPA, appointed DPO, up-to-date processing register, data hosted in EU.",
        red_flags_fr: "Pas de DPA, données hors UE sans cadre juridique, pas de registre.",
        red_flags_en: "No DPA, data outside EU without legal framework, no register.",
        evidence_fr: "DPA signé, registre des traitements, attestation de localisation",
        evidence_en: "Signed DPA, processing register, location attestation",
        weight: 10
    },
    {
        id: "Q14", domain: "data_protection",
        text_fr: "Disposez-vous d'une politique de classification et de rétention des données ?",
        text_en: "Do you have a data classification and retention policy?",
        expected_fr: "Politique de classification (public, interne, confidentiel, secret), durées de rétention définies, purge automatisée.",
        expected_en: "Classification policy (public, internal, confidential, secret), defined retention periods, automated purging.",
        red_flags_fr: "Pas de classification, rétention illimitée, pas de purge.",
        red_flags_en: "No classification, unlimited retention, no purging.",
        evidence_fr: "Politique de classification, matrice de rétention",
        evidence_en: "Classification policy, retention matrix",
        weight: 6
    },
    // ── Endpoint protection ──────────────────────────────────────
    {
        id: "Q15", domain: "endpoint_protection",
        text_fr: "Un EDR est-il déployé et supervisé sur l'ensemble du parc, intégré à un SIEM ?",
        text_en: "Is an EDR deployed and monitored across all endpoints, integrated with a SIEM?",
        expected_fr: "EDR sur 100% du parc, supervision 24/7, intégration SIEM, playbooks de réponse.",
        expected_en: "EDR on 100% of endpoints, 24/7 monitoring, SIEM integration, response playbooks.",
        red_flags_fr: "Antivirus simple, couverture partielle, pas de supervision.",
        red_flags_en: "Basic antivirus, partial coverage, no monitoring.",
        evidence_fr: "Taux de couverture EDR, SLA de détection, playbooks",
        evidence_en: "EDR coverage rate, detection SLAs, playbooks",
        weight: 10
    },
    // ── Detection & incident response ────────────────────────────
    {
        id: "Q16", domain: "incident_response",
        text_fr: "Disposez-vous d'un plan de réponse aux incidents documenté et testé ?",
        text_en: "Do you have a documented and tested incident response plan?",
        expected_fr: "Plan de réponse formalisé, équipe CSIRT/SOC identifiée, exercices annuels.",
        expected_en: "Formalized response plan, identified CSIRT/SOC team, annual exercises.",
        red_flags_fr: "Pas de plan de réponse, pas d'équipe dédiée, jamais testé.",
        red_flags_en: "No response plan, no dedicated team, never tested.",
        evidence_fr: "Plan de réponse aux incidents, rapport d'exercice, contacts d'escalade",
        evidence_en: "Incident response plan, exercise report, escalation contacts",
        weight: 10
    },
    {
        id: "Q17", domain: "incident_response",
        text_fr: "Quel est votre délai de notification en cas d'incident affectant nos données ?",
        text_en: "What is your notification timeline for incidents affecting our data?",
        expected_fr: "Notification < 24h pour incidents majeurs, < 72h conforme RGPD, rapport structuré.",
        expected_en: "Notification < 24h for major incidents, < 72h GDPR compliant, structured report.",
        red_flags_fr: "Pas de délai défini, notification uniquement sur demande.",
        red_flags_en: "No defined timeline, notification only upon request.",
        evidence_fr: "Clause contractuelle de notification, procédure d'escalade",
        evidence_en: "Contractual notification clause, escalation procedure",
        weight: 8
    },
    // ── Business continuity ──────────────────────────────────────
    {
        id: "Q18", domain: "continuity",
        text_fr: "Quelle est la fréquence des sauvegardes ? Quels sont vos RTO/RPO ? Le plan de reprise est-il testé ?",
        text_en: "What is the backup frequency? What are your RTO/RPO? Is the disaster recovery plan tested?",
        expected_fr: "Backups quotidiens, RTO <4h, RPO <1h, PRA testé annuellement.",
        expected_en: "Daily backups, RTO <4h, RPO <1h, DRP tested annually.",
        red_flags_fr: "Pas de test PRA, RTO non défini, backups non vérifiés.",
        red_flags_en: "No DRP tests, RTO not defined, backups not verified.",
        evidence_fr: "Rapports de test PRA, métriques de restauration, politique de backup",
        evidence_en: "DRP test reports, restoration metrics, backup policy",
        weight: 10
    },
    {
        id: "Q19", domain: "continuity",
        text_fr: "Disposez-vous d'une architecture haute disponibilité avec redondance géographique ?",
        text_en: "Do you have a high-availability architecture with geographic redundancy?",
        expected_fr: "Multi-AZ ou multi-région, failover automatique, SLA de disponibilité ≥ 99.9%.",
        expected_en: "Multi-AZ or multi-region, automatic failover, availability SLA ≥ 99.9%.",
        red_flags_fr: "Site unique, pas de redondance, SLA < 99.5%.",
        red_flags_en: "Single site, no redundancy, SLA < 99.5%.",
        evidence_fr: "Schéma d'architecture, SLA contractuel, historique de disponibilité",
        evidence_en: "Architecture diagram, contractual SLA, availability history",
        weight: 6
    },
    // ── Supply chain ─────────────────────────────────────────────
    {
        id: "Q20", domain: "supply_chain",
        text_fr: "Maintenez-vous un inventaire de vos sous-traitants (4th parties) ? Les évaluez-vous ?",
        text_en: "Do you maintain an inventory of your sub-contractors (4th parties)? Do you assess them?",
        expected_fr: "Registre des sous-traitants, évaluation annuelle, clauses contractuelles de sécurité.",
        expected_en: "Sub-contractor register, annual assessment, security contractual clauses.",
        red_flags_fr: "Pas d'inventaire, pas d'évaluation, sous-traitance non encadrée.",
        red_flags_en: "No inventory, no assessment, uncontrolled subcontracting.",
        evidence_fr: "Registre des 4th parties, clauses contractuelles, évaluations",
        evidence_en: "4th-party register, contractual clauses, assessments",
        weight: 10
    },
    // ── Human resources ──────────────────────────────────────────
    {
        id: "Q21", domain: "hr_security",
        text_fr: "Les collaborateurs suivent-ils une formation de sensibilisation à la sécurité (incluant phishing) ?",
        text_en: "Do employees undergo security awareness training (including phishing)?",
        expected_fr: "Formation annuelle obligatoire, campagnes de phishing simulé, indicateurs de suivi.",
        expected_en: "Mandatory annual training, simulated phishing campaigns, tracking metrics.",
        red_flags_fr: "Pas de formation, formation unique à l'embauche, pas de simulation phishing.",
        red_flags_en: "No training, one-time onboarding training only, no phishing simulation.",
        evidence_fr: "Programme de formation, taux de participation, résultats phishing",
        evidence_en: "Training program, participation rate, phishing results",
        weight: 8
    },
    {
        id: "Q22", domain: "hr_security",
        text_fr: "Réalisez-vous des vérifications de background check pour les postes sensibles ?",
        text_en: "Do you perform background checks for sensitive positions?",
        expected_fr: "Vérification des antécédents pour postes à privilèges, NDA signé, clause de confidentialité.",
        expected_en: "Background verification for privileged positions, signed NDA, confidentiality clause.",
        red_flags_fr: "Pas de vérification, pas de NDA, accès immédiat aux données sensibles.",
        red_flags_en: "No verification, no NDA, immediate access to sensitive data.",
        evidence_fr: "Politique RH, modèle de NDA, procédure d'onboarding",
        evidence_en: "HR policy, NDA template, onboarding procedure",
        weight: 6
    },
    // ── Cloud security ───────────────────────────────────────────
    {
        id: "Q23", domain: "cloud_security",
        text_fr: "Quel est votre modèle d'hébergement (cloud public, privé, hybride, on-premise) et quelles certifications possédez-vous ?",
        text_en: "What is your hosting model (public cloud, private, hybrid, on-premise) and what certifications do you hold?",
        expected_fr: "Hébergement documenté, certifications cloud (ISO 27017/27018, SOC 2, SecNumCloud, C5).",
        expected_en: "Documented hosting, cloud certifications (ISO 27017/27018, SOC 2, SecNumCloud, C5).",
        red_flags_fr: "Hébergement non documenté, pas de certification, infrastructure partagée non isolée.",
        red_flags_en: "Undocumented hosting, no certification, non-isolated shared infrastructure.",
        evidence_fr: "Certificats, attestation d'hébergement, architecture cloud",
        evidence_en: "Certificates, hosting attestation, cloud architecture",
        weight: 8
    },
    {
        id: "Q24", domain: "cloud_security",
        text_fr: "La journalisation est-elle activée sur tous les services (accès, modifications, API) avec une rétention ≥ 12 mois ?",
        text_en: "Is logging enabled on all services (access, changes, API) with retention ≥ 12 months?",
        expected_fr: "Journalisation centralisée, rétention ≥ 12 mois, alertes sur événements critiques.",
        expected_en: "Centralized logging, retention ≥ 12 months, alerts on critical events.",
        red_flags_fr: "Pas de journalisation, rétention < 3 mois, logs non accessibles au client.",
        red_flags_en: "No logging, retention < 3 months, logs not accessible to customer.",
        evidence_fr: "Politique de journalisation, architecture SIEM, exemples d'alertes",
        evidence_en: "Logging policy, SIEM architecture, sample alerts",
        weight: 8
    },
    // ── Compliance & certifications ──────────────────────────────
    {
        id: "Q25", domain: "compliance",
        text_fr: "Quelles certifications de sécurité détenez-vous et quelle est leur date de validité ?",
        text_en: "What security certifications do you hold and when do they expire?",
        expected_fr: "ISO 27001, SOC 2 Type II, HDS (si santé), certificats valides et périmètre couvrant nos services.",
        expected_en: "ISO 27001, SOC 2 Type II, HDS (if healthcare), valid certificates covering our services.",
        red_flags_fr: "Aucune certification, certificats expirés, périmètre ne couvrant pas nos services.",
        red_flags_en: "No certifications, expired certificates, scope not covering our services.",
        evidence_fr: "Certificats ISO/SOC/HDS, périmètre de certification, dates de validité",
        evidence_en: "ISO/SOC/HDS certificates, certification scope, validity dates",
        weight: 10
    }
];

var TPRM_DORA_QUESTIONS = [
    {
        id: "D01", domain: "dora_resilience",
        text_fr: "Avez-vous un programme de tests de résilience opérationnelle numérique (TLPT, tests de basculement) ?",
        text_en: "Do you have a digital operational resilience testing program (TLPT, failover tests)?",
        expected_fr: "Tests de résilience réguliers, scénarios de crise, exercices de basculement documentés.",
        expected_en: "Regular resilience tests, crisis scenarios, documented failover exercises.",
        red_flags_fr: "Pas de tests de résilience, pas de scénarios de crise.",
        red_flags_en: "No resilience tests, no crisis scenarios.",
        evidence_fr: "Rapports de tests, scénarios, résultats",
        evidence_en: "Test reports, scenarios, results",
        weight: 10
    },
    {
        id: "D02", domain: "dora_exit",
        text_fr: "Disposez-vous d'un plan de sortie documenté garantissant la réversibilité des données et la continuité de service ?",
        text_en: "Do you have a documented exit plan ensuring data reversibility and service continuity?",
        expected_fr: "Plan de sortie formalisé, réversibilité testée, délais de transition définis, format d'export standard.",
        expected_en: "Formalized exit plan, tested reversibility, defined transition timelines, standard export format.",
        red_flags_fr: "Pas de plan de sortie, données non exportables, lock-in technique.",
        red_flags_en: "No exit plan, non-exportable data, technical lock-in.",
        evidence_fr: "Plan de sortie, procédure d'export, SLA de transition",
        evidence_en: "Exit plan, export procedure, transition SLA",
        weight: 10
    },
    {
        id: "D03", domain: "dora_notification",
        text_fr: "Quel est votre processus de notification des incidents majeurs et vos délais contractuels ?",
        text_en: "What is your major incident notification process and contractual timelines?",
        expected_fr: "Notification < 4h pour incidents majeurs, rapport d'incident structuré, point de contact dédi��.",
        expected_en: "Notification < 4h for major incidents, structured incident report, dedicated contact point.",
        red_flags_fr: "Pas de délai contractuel, notification uniquement sur demande.",
        red_flags_en: "No contractual timeline, notification only upon request.",
        evidence_fr: "Clause de notification, procédure d'escalade, modèle de rapport",
        evidence_en: "Notification clause, escalation procedure, report template",
        weight: 10
    },
    {
        id: "D04", domain: "dora_subcontracting",
        text_fr: "Votre chaîne de sous-traitance TIC est-elle documentée, évaluée et maîtrisée ?",
        text_en: "Is your ICT subcontracting chain documented, assessed, and controlled?",
        expected_fr: "Registre complet des sous-traitants TIC, évaluation de sécurité, clauses contractuelles, droit d'audit.",
        expected_en: "Complete ICT sub-contractor register, security assessment, contractual clauses, audit rights.",
        red_flags_fr: "Chaîne non documentée, sous-traitance hors contrôle.",
        red_flags_en: "Undocumented chain, uncontrolled subcontracting.",
        evidence_fr: "Registre des sous-traitants TIC, clauses, évaluations",
        evidence_en: "ICT sub-contractor register, clauses, assessments",
        weight: 10
    },
    {
        id: "D05", domain: "dora_location",
        text_fr: "Où sont localisés les données et les traitements ? Existe-t-il des transferts hors UE ?",
        text_en: "Where are data and processing located? Are there any transfers outside the EU?",
        expected_fr: "Données et traitements en UE, pas de transfert hors UE ou cadre juridique adéquat (décision d'adéquation, SCC).",
        expected_en: "Data and processing in EU, no transfer outside EU or adequate legal framework (adequacy decision, SCC).",
        red_flags_fr: "Localisation inconnue, transferts hors UE sans cadre juridique.",
        red_flags_en: "Unknown location, transfers outside EU without legal framework.",
        evidence_fr: "Attestation de localisation, cartographie des flux, clauses contractuelles",
        evidence_en: "Location attestation, flow mapping, contractual clauses",
        weight: 10
    }
];

// Risk categories
var TPRM_RISK_CATEGORIES = [
    { id: "CYBER", label_fr: "Cybersécurité", label_en: "Cybersecurity" },
    { id: "OPS",   label_fr: "Opérationnel",  label_en: "Operational" },
    { id: "FIN",   label_fr: "Financier",     label_en: "Financial" },
    { id: "COMP",  label_fr: "Conformité",    label_en: "Compliance" },
    { id: "STRAT", label_fr: "Stratégique",   label_en: "Strategic" },
    { id: "REP",   label_fr: "Réputation",    label_en: "Reputational" },
    { id: "GEO",   label_fr: "Géopolitique",  label_en: "Geopolitical" }
];

// Certifications list
var TPRM_CERTIFICATIONS = [
    "ISO 27001", "SOC 2 Type I", "SOC 2 Type II", "HDS", "PCI DSS",
    "ISO 27017", "ISO 27018", "ISO 22301", "CSA STAR", "TISAX",
    "Cyber Essentials", "C5", "ENS", "SecNumCloud"
];
