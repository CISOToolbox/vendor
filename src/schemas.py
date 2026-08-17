from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── User schemas ──────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None
    picture: str | None
    provider: str
    role: str
    ai_enabled: str
    created_at: datetime
    last_login: datetime | None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    role: str | None = None
    ai_enabled: str | None = None


class ShareRequest(BaseModel):
    email: str
    permissions: list[str] = ["read"]


# ── Project schemas ──────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = ""
    organization: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = None
    organization: str | None = None
    data: dict[str, Any] | None = None
    # FEAT-33 stale-tab guard (see routes/projects.update_project).
    expected_server_rev: int | None = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    name: str
    organization: str | None
    owner_id: uuid.UUID | None
    shared_with: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime
    server_rev: int = 0
    data: dict[str, Any]

    model_config = {"from_attributes": True}


class ProjectListItem(BaseModel):
    id: uuid.UUID
    name: str
    organization: str | None
    owner_id: uuid.UUID | None
    shared_with: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── AI schemas ───────────────────────────────────────────────────

class AICompleteRequest(BaseModel):
    system: str
    user: str
    provider: str = "anthropic"
    model: str = "claude-sonnet-4-6"


class AICompleteResponse(BaseModel):
    text: str


class AIConfigResponse(BaseModel):
    anthropic_configured: bool
    openai_configured: bool
    gemini_configured: bool = False
    providers: dict[str, dict[str, Any]]


class AIRuntimeResponse(BaseModel):
    managed: bool
    can_use: bool
    provider: str
    model: str
    anthropic_configured: bool
    openai_configured: bool
    gemini_configured: bool = False
    custom_configured: bool = False


# ── Project stats ────────────────────────────────────────────────

class ProjectStats(BaseModel):
    total_vendors: int
    total_risks: int
    total_measures: int
    total_assessments: int
    total_documents: int
    vendors_by_tier: dict[str, int]
    vendors_by_status: dict[str, int]
    risks_by_level: dict[str, int]
    avg_assessment_score: float | None
    measures_progress: float | None


# ── Nested value objects (JSONB fields) ──────────────────────────

class ContactInfo(BaseModel):
    name: str = ""
    email: str = ""


class ContractInfo(BaseModel):
    services: str = ""
    start_date: str = ""
    end_date: str = ""
    review_date: str = ""


class ClassificationInfo(BaseModel):
    ops_impact: int = 0
    processes: int = 0
    replace_difficulty: int = 0
    data_sensitivity: int = 0
    integration: int = 0
    regulatory_impact: int = 0
    gdpr_subprocessor: bool = False


class ExposureInfo(BaseModel):
    dependance: float = 0
    penetration: float = 0
    maturite: float = 0
    confiance: float = 0


class TreatmentInfo(BaseModel):
    response: str = ""
    details: str = ""
    due_date: str = ""


# ── Project Metadata ────────────────────────────────────────────

class ProjectMetadataCreate(BaseModel):
    organization: str | None = None
    created_date: str | None = None


class ProjectMetadataResponse(BaseModel):
    project_id: uuid.UUID
    organization: str | None
    created_date: str | None

    model_config = {"from_attributes": True}


# ── Vendor ──────────────────────────────────────────────────────

class VendorCreate(BaseModel):
    id: str
    name: str = ""
    legal_entity: str = ""
    country: str = ""
    sector: str = ""
    website: str = ""
    siret: str = ""
    status: str = "active"
    notes: str = ""
    logo: str = ""
    dpa_signed: bool = False
    contact: ContactInfo = Field(default_factory=ContactInfo)
    internal_contact: ContactInfo = Field(default_factory=ContactInfo)
    contract: ContractInfo = Field(default_factory=ContractInfo)
    classification: ClassificationInfo = Field(default_factory=ClassificationInfo)
    exposure: ExposureInfo = Field(default_factory=ExposureInfo)
    certifications: list[Any] = Field(default_factory=list)
    sub_contractors: list[Any] = Field(default_factory=list)
    sort_order: int = 0


class VendorUpdate(BaseModel):
    name: str | None = None
    legal_entity: str | None = None
    country: str | None = None
    sector: str | None = None
    website: str | None = None
    siret: str | None = None
    status: str | None = None
    notes: str | None = None
    logo: str | None = None
    dpa_signed: bool | None = None
    contact: ContactInfo | None = None
    internal_contact: ContactInfo | None = None
    contract: ContractInfo | None = None
    classification: ClassificationInfo | None = None
    exposure: ExposureInfo | None = None
    certifications: list[Any] | None = None
    sub_contractors: list[Any] | None = None
    sort_order: int | None = None


class VendorResponse(BaseModel):
    id: str
    project_id: uuid.UUID
    sort_order: int
    name: str
    legal_entity: str | None
    country: str | None
    sector: str | None
    website: str | None
    siret: str | None
    status: str
    notes: str | None
    logo: str | None
    dpa_signed: bool
    contact: dict[str, Any]
    internal_contact: dict[str, Any]
    contract: dict[str, Any]
    classification: dict[str, Any]
    exposure: dict[str, Any]
    certifications: list[Any]
    sub_contractors: list[Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Vendor Measure ──────────────────────────────────────────────

class VendorMeasureCreate(BaseModel):
    id: str
    vendor_id: str
    mesure: str = ""
    details: str = ""
    type: str = ""
    statut: str = "a_faire"
    responsable: str = ""
    echeance: str = ""
    ref_socle: str = ""
    effet: str = ""
    sort_order: int = 0
    progress_log: list[Any] = Field(default_factory=list)
    # Provenance (assessment → measure); persisted so the origin gap is traceable.
    source: str = ""
    source_assessment_id: str = ""
    source_question_id: str = ""


class VendorMeasureUpdate(BaseModel):
    mesure: str | None = None
    details: str | None = None
    type: str | None = None
    statut: str | None = None
    responsable: str | None = None
    echeance: str | None = None
    ref_socle: str | None = None
    effet: str | None = None
    sort_order: int | None = None
    progress_log: list[Any] | None = None


class VendorMeasureResponse(BaseModel):
    id: str
    project_id: uuid.UUID
    vendor_id: str
    sort_order: int
    mesure: str
    details: str | None
    type: str | None
    statut: str
    responsable: str | None
    echeance: str | None
    ref_socle: str | None
    effet: str | None
    progress_log: list[Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Vendor Risk ─────────────────────────────────────────────────

class VendorRiskCreate(BaseModel):
    id: str
    vendor_id: str
    title: str = ""
    description: str = ""
    category: str = ""
    impact: int | None = None
    likelihood: int | None = None
    residual_impact: int | None = None
    residual_likelihood: int | None = None
    status: str = "active"
    linked_measures: str = ""
    treatment: TreatmentInfo = Field(default_factory=TreatmentInfo)
    sort_order: int = 0


class VendorRiskUpdate(BaseModel):
    vendor_id: str | None = None
    title: str | None = None
    description: str | None = None
    category: str | None = None
    impact: int | None = None
    likelihood: int | None = None
    residual_impact: int | None = None
    residual_likelihood: int | None = None
    status: str | None = None
    linked_measures: str | None = None
    treatment: TreatmentInfo | None = None
    sort_order: int | None = None


class VendorRiskResponse(BaseModel):
    id: str
    project_id: uuid.UUID
    vendor_id: str
    sort_order: int
    title: str
    description: str | None
    category: str | None
    impact: int | None
    likelihood: int | None
    residual_impact: int | None
    residual_likelihood: int | None
    status: str
    linked_measures: str | None
    treatment: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Vendor Document ─────────────────────────────────────────────

class VendorDocumentCreate(BaseModel):
    id: str
    vendor_id: str
    name: str = ""
    type: str = ""
    url: str = ""
    expiry_date: str = ""
    source: str = ""
    verified: bool = False
    sort_order: int = 0


class VendorDocumentUpdate(BaseModel):
    vendor_id: str | None = None
    name: str | None = None
    type: str | None = None
    url: str | None = None
    expiry_date: str | None = None
    source: str | None = None
    verified: bool | None = None
    sort_order: int | None = None


class VendorDocumentResponse(BaseModel):
    id: str
    project_id: uuid.UUID
    vendor_id: str
    sort_order: int
    name: str
    type: str | None
    url: str | None
    expiry_date: str | None
    source: str | None
    verified: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Vendor Assessment ───────────────────────────────────────────

class VendorAssessmentCreate(BaseModel):
    id: str
    vendor_id: str
    title: str = ""
    status: str = "draft"
    date: str = ""
    score: float | None = None
    assessor: str = ""
    responses: list[Any] = Field(default_factory=list)
    sort_order: int = 0
    # ── Phase 0b fields (template-driven assessments) ──
    # See src/assessment_validation.py for the full data contract.
    type: str | None = "periodic"
    due_date: str | None = ""
    template_id: str | None = None
    template_version: int | None = None
    template_snapshot: dict | None = None
    self_validation: bool = False
    self_validated_at: str | None = None
    completion_rate: int | None = 0


class VendorAssessmentUpdate(BaseModel):
    vendor_id: str | None = None
    title: str | None = None
    status: str | None = None
    date: str | None = None
    score: float | None = None
    assessor: str | None = None
    responses: list[Any] | None = None
    sort_order: int | None = None
    # ── Phase 0b fields ──
    type: str | None = None
    due_date: str | None = None
    template_id: str | None = None
    template_version: int | None = None
    template_snapshot: dict | None = None
    self_validation: bool | None = None
    self_validated_at: str | None = None
    completion_rate: int | None = None
    # Reviewer fields accepted by the schema but STRIPPED server-side
    # before persistence (see assessment_validation.SERVER_ASSIGNED_FIELDS).
    # Kept here so naive clients that echo them back don't trigger 422.
    submitted_at: str | None = None
    approved_at: str | None = None
    approved_by: str | None = None
    rejected_reason: str | None = None


class VendorAssessmentResponse(BaseModel):
    id: str
    project_id: uuid.UUID
    vendor_id: str
    sort_order: int
    title: str
    status: str
    date: str | None
    score: float | None
    assessor: str | None
    responses: list[Any]
    # Phase 0b fields
    type: str | None = None
    due_date: str | None = None
    template_id: str | None = None
    template_version: int | None = None
    template_snapshot: dict | None = None
    self_validation: bool = False
    self_validated_at: str | None = None
    submitted_at: str | None = None
    approved_at: str | None = None
    approved_by: str | None = None
    rejected_reason: str | None = None
    completion_rate: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Project Export (backwards-compatible D object) ───────────────

class VendorExportItem(BaseModel):
    """Vendor in the flat export format matching the frontend D object."""
    id: str
    name: str
    legal_entity: str = ""
    country: str = ""
    sector: str = ""
    website: str = ""
    siret: str = ""
    status: str = "active"
    contact: dict[str, Any] = Field(default_factory=dict)
    internal_contact: dict[str, Any] = Field(default_factory=dict)
    contract: dict[str, Any] = Field(default_factory=dict)
    classification: dict[str, Any] = Field(default_factory=dict)
    exposure: dict[str, Any] = Field(default_factory=dict)
    certifications: list[Any] = Field(default_factory=list)
    dpa_signed: bool = False
    sub_contractors: list[Any] = Field(default_factory=list)
    measures: list[dict[str, Any]] = Field(default_factory=list)
    notes: str = ""
    logo: str = ""


class RiskExportItem(BaseModel):
    id: str
    vendor_id: str
    title: str
    description: str = ""
    category: str = ""
    impact: int | None = None
    likelihood: int | None = None
    treatment: dict[str, Any] = Field(default_factory=dict)
    residual_impact: int | None = None
    residual_likelihood: int | None = None
    status: str = "active"
    linked_measures: str = ""


class DocumentExportItem(BaseModel):
    id: str
    vendor_id: str
    name: str
    type: str = ""
    url: str = ""
    expiry_date: str = ""
    source: str = ""
    verified: bool = False


class AssessmentExportItem(BaseModel):
    id: str
    vendor_id: str
    title: str = ""
    status: str = "draft"
    date: str = ""
    score: float | None = None
    assessor: str = ""
    responses: list[Any] = Field(default_factory=list)


class MetadataExport(BaseModel):
    organization: str = ""
    created: str = ""


class ProjectExport(BaseModel):
    """Full project export matching the frontend D object structure."""
    metadata: MetadataExport = Field(default_factory=MetadataExport)
    vendors: list[VendorExportItem] = Field(default_factory=list)
    risks: list[RiskExportItem] = Field(default_factory=list)
    assessments: list[AssessmentExportItem] = Field(default_factory=list)
    documents: list[DocumentExportItem] = Field(default_factory=list)


# ── DORA Register of Information schemas ────────────────────────
# EBA Reg. (EU) 2024/2956. Granular per-entity persistence.
# All Update schemas use Optional fields for PATCH semantics
# (model_dump(exclude_unset=True) → partial patch).


class DoraEntityCreate(BaseModel):
    id: str
    sort_order: int = 0
    lei: str
    name: str = ""
    country_iso2: str = ""
    competent_authority: str | None = ""
    entity_type: str | None = ""
    hierarchy: str | None = ""
    parent_lei: str | None = None
    total_assets: float | None = None
    total_assets_currency: str | None = "EUR"
    reporting_period: str | None = ""


class DoraEntityUpdate(BaseModel):
    sort_order: int | None = None
    lei: str | None = None
    name: str | None = None
    country_iso2: str | None = None
    competent_authority: str | None = None
    entity_type: str | None = None
    hierarchy: str | None = None
    parent_lei: str | None = None
    total_assets: float | None = None
    total_assets_currency: str | None = None
    reporting_period: str | None = None


class DoraEntityResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    sort_order: int
    lei: str
    name: str
    country_iso2: str
    competent_authority: str | None
    entity_type: str | None
    hierarchy: str | None
    parent_lei: str | None
    total_assets: float | None
    total_assets_currency: str | None
    reporting_period: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraFunctionCreate(BaseModel):
    id: str
    code: str | None = ""
    sort_order: int = 0
    name: str = ""
    description: str | None = ""
    is_critical_or_important: bool = False
    criticality_rationale: str | None = ""
    business_line: str | None = ""
    lou_code: str | None = ""
    recovery_time_objective_h: float | None = None
    recovery_point_objective_h: float | None = None
    impact_tolerance_description: str | None = ""
    last_assessment_date: str | None = None


class DoraFunctionUpdate(BaseModel):
    code: str | None = None
    sort_order: int | None = None
    name: str | None = None
    description: str | None = None
    is_critical_or_important: bool | None = None
    criticality_rationale: str | None = None
    business_line: str | None = None
    lou_code: str | None = None
    recovery_time_objective_h: float | None = None
    recovery_point_objective_h: float | None = None
    impact_tolerance_description: str | None = None
    last_assessment_date: str | None = None


class DoraFunctionResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    code: str | None = ""
    sort_order: int
    name: str
    description: str | None
    is_critical_or_important: bool
    criticality_rationale: str | None
    business_line: str | None
    lou_code: str | None
    recovery_time_objective_h: float | None
    recovery_point_objective_h: float | None
    impact_tolerance_description: str | None
    last_assessment_date: str | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraBranchCreate(BaseModel):
    id: str
    rfe_id: str
    sort_order: int = 0
    name: str | None = ""
    country_iso2: str = ""
    lei: str | None = None
    branch_code: str | None = ""


class DoraBranchUpdate(BaseModel):
    sort_order: int | None = None
    name: str | None = None
    country_iso2: str | None = None
    lei: str | None = None
    branch_code: str | None = None


class DoraBranchResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    rfe_id: str
    sort_order: int
    name: str | None
    country_iso2: str
    lei: str | None
    branch_code: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraConsolidationScopeCreate(BaseModel):
    id: str
    sort_order: int = 0
    entity_lei: str
    entity_name: str | None = ""
    relation_to_rfe: str | None = ""
    inclusion_method: str | None = ""
    country_iso2: str | None = ""


class DoraConsolidationScopeUpdate(BaseModel):
    sort_order: int | None = None
    entity_lei: str | None = None
    entity_name: str | None = None
    relation_to_rfe: str | None = None
    inclusion_method: str | None = None
    country_iso2: str | None = None


class DoraConsolidationScopeResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    sort_order: int
    entity_lei: str
    entity_name: str | None
    relation_to_rfe: str | None
    inclusion_method: str | None
    country_iso2: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraArrangementCreate(BaseModel):
    id: str
    vendor_id: str
    sort_order: int = 0
    arrangement_reference: str = ""
    arrangement_type: str | None = ""
    function_ids: list[str] = Field(default_factory=list)
    is_critical_function_support: bool = False
    start_date: str | None = ""
    end_date: str | None = ""
    notice_period_days: int | None = None
    governing_law_country: str | None = ""
    jurisdiction_country: str | None = ""
    annual_cost_amount: float | None = None
    currency: str | None = "EUR"
    nature_of_service: str | None = ""
    data_sensitivity: str | None = ""
    data_storage_country: str | None = ""
    data_processing_country: str | None = ""
    substitutability_level: str | None = ""
    substitutability_reason: str | None = ""
    reintegration_level: str | None = ""
    is_substitutable: bool = False
    exit_strategy_documented: bool = False
    reintegration_possible: bool = False
    last_audit_date: str | None = ""
    # Migration 011 — EBA RoI completeness
    reliance_level: str | None = None
    impact_discontinuing_level: str | None = None
    alternative_tpp_id: str | None = None
    notice_period_tpsp_days: int | None = None
    termination_reason: str | None = None
    parent_arrangement_id: str | None = None
    rfe_ids: list[str] = Field(default_factory=list)
    service_codes: list[str] = Field(default_factory=list)


class DoraArrangementUpdate(BaseModel):
    sort_order: int | None = None
    arrangement_reference: str | None = None
    arrangement_type: str | None = None
    function_ids: list[str] | None = None
    is_critical_function_support: bool | None = None
    start_date: str | None = None
    end_date: str | None = None
    notice_period_days: int | None = None
    governing_law_country: str | None = None
    jurisdiction_country: str | None = None
    annual_cost_amount: float | None = None
    currency: str | None = None
    nature_of_service: str | None = None
    data_sensitivity: str | None = None
    data_storage_country: str | None = None
    data_processing_country: str | None = None
    substitutability_level: str | None = None
    substitutability_reason: str | None = None
    reintegration_level: str | None = None
    is_substitutable: bool | None = None
    exit_strategy_documented: bool | None = None
    reintegration_possible: bool | None = None
    last_audit_date: str | None = None
    # Migration 011 — EBA RoI completeness
    reliance_level: str | None = None
    impact_discontinuing_level: str | None = None
    alternative_tpp_id: str | None = None
    notice_period_tpsp_days: int | None = None
    termination_reason: str | None = None
    parent_arrangement_id: str | None = None
    service_codes: list[str] | None = None


class DoraArrangementResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    vendor_id: str
    sort_order: int
    arrangement_reference: str
    arrangement_type: str | None
    function_ids: list[str] = Field(default_factory=list)
    is_critical_function_support: bool
    start_date: str | None
    end_date: str | None
    notice_period_days: int | None
    governing_law_country: str | None
    jurisdiction_country: str | None
    annual_cost_amount: float | None
    currency: str | None
    nature_of_service: str | None
    data_sensitivity: str | None
    data_storage_country: str | None
    data_processing_country: str | None
    substitutability_level: str | None
    substitutability_reason: str | None
    reintegration_level: str | None
    is_substitutable: bool
    exit_strategy_documented: bool
    reintegration_possible: bool
    last_audit_date: str | None
    # Migration 011 — EBA RoI completeness
    reliance_level: str | None = None
    impact_discontinuing_level: str | None = None
    alternative_tpp_id: str | None = None
    notice_period_tpsp_days: int | None = None
    termination_reason: str | None = None
    parent_arrangement_id: str | None = None
    rfe_ids: list[str] = Field(default_factory=list)
    service_codes: list[str] = Field(default_factory=list)
    subcontractor_links: list["DoraArrangementSubcontractorResponse"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraArrangementRfeLink(BaseModel):
    """Body for POST/DELETE arrangements/{aid}/rfes/{rfe_id}."""
    rfe_id: str


class DoraSignerCreate(BaseModel):
    id: str
    sort_order: int = 0
    signer_lei: str | None = None
    signer_name: str = ""
    signer_role: str | None = ""
    signed_on: str | None = ""


class DoraSignerUpdate(BaseModel):
    sort_order: int | None = None
    signer_lei: str | None = None
    signer_name: str | None = None
    signer_role: str | None = None
    signed_on: str | None = None


class DoraSignerResponse(BaseModel):
    project_id: uuid.UUID
    arrangement_id: str
    id: str
    sort_order: int
    signer_lei: str | None
    signer_name: str
    signer_role: str | None
    signed_on: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraSubcontractorCreate(BaseModel):
    """Identity-only payload (per-link fields go via ArrangementSubcontractor)."""
    id: str
    sort_order: int = 0
    lei: str | None = None
    name: str = ""
    country_iso2: str | None = ""
    sector: str | None = None


class DoraSubcontractorUpdate(BaseModel):
    sort_order: int | None = None
    lei: str | None = None
    name: str | None = None
    country_iso2: str | None = None
    sector: str | None = None


class DoraSubcontractorResponse(BaseModel):
    project_id: uuid.UUID
    id: str
    sort_order: int
    lei: str | None
    name: str
    country_iso2: str | None
    sector: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraArrangementSubcontractorCreate(BaseModel):
    """Per-link attributes binding a subcontractor to an arrangement.

    `is_critical_function_support` is server-derived from the parent
    arrangement (R1: not trusted from client to prevent misrepresentation
    of regulatory declarations).
    """
    subcontractor_id: str
    sort_order: int = 0
    # EBA DORA RoI: subcontractor links are rank ≥ 2 by definition
    # (rank 1 = direct TPSP itself, generated by the export).
    tier: int = 2
    service_provided: str | None = ""
    parent_subcontractor_id: str | None = None
    data_country: str | None = ""


class DoraArrangementSubcontractorUpdate(BaseModel):
    sort_order: int | None = None
    tier: int | None = None
    service_provided: str | None = None
    parent_subcontractor_id: str | None = None
    data_country: str | None = None


class DoraArrangementSubcontractorResponse(BaseModel):
    project_id: uuid.UUID
    arrangement_id: str
    subcontractor_id: str
    sort_order: int
    tier: int
    service_provided: str | None
    is_critical_function_support: bool
    parent_subcontractor_id: str | None
    data_country: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class DoraVendorRoIPatch(BaseModel):
    """PATCH /vendors/{id}/roi — sets the 9 vendor-level RoI fields."""
    lei: str | None = None
    legal_name_latin: str | None = None
    person_type: str | None = None
    entity_nature: str | None = None
    additional_id_type: str | None = None
    additional_id_value: str | None = None
    additional_id_issuer: str | None = None
    ultimate_parent_id: str | None = None
    country_iso2: str | None = None


# Resolve forward refs (DoraArrangementResponse references the subcontractor
# junction schema declared further down).
DoraArrangementResponse.model_rebuild()

