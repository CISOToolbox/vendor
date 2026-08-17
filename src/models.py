from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, ForeignKeyConstraint,
    Index, Integer, String, Text, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── Auth & Settings (unchanged) ─────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=True)
    picture = Column(String(500), nullable=True)
    provider = Column(String(50), nullable=False)
    provider_id = Column(String(255), nullable=False)
    role = Column(String(50), default="user", server_default=text("'user'"))
    ai_enabled = Column(String(5), default="false", server_default=text("'false'"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    last_login = Column(DateTime(timezone=True), nullable=True)


class AppSettings(Base):
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False, default="")


# ── Project (data column kept for backwards compat, deprecated) ─

class Project(Base):
    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    name = Column(String(255), nullable=False, default="")
    organization = Column(String(255), nullable=True)
    owner_id = Column(UUID(as_uuid=True),
                      # SET NULL, not the NO ACTION default: deleting a user must
                      # not be blocked by the objects they happen to own. The
                      # ownership idiom already tolerates a null owner.
                      ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    shared_with = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    # FEAT-33 — bumped ONLY by server-initiated writers (Pilot write-back,
    # restore, schedulers). Guards the blob PUT against stale-tab overwrite.
    server_rev = Column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    metadata_rel = relationship("ProjectMetadata", back_populates="project", uselist=False, cascade="all, delete-orphan")
    vendors = relationship("Vendor", back_populates="project", cascade="all, delete-orphan", order_by="Vendor.sort_order")
    risks = relationship("VendorRisk", back_populates="project", cascade="all, delete-orphan", order_by="VendorRisk.sort_order")
    documents = relationship("VendorDocument", back_populates="project", cascade="all, delete-orphan", order_by="VendorDocument.sort_order")
    assessments = relationship("VendorAssessment", back_populates="project", cascade="all, delete-orphan", order_by="VendorAssessment.sort_order")


# ── Project Metadata ────────────────────────────────────────────

class ProjectMetadata(Base):
    """Top-level metadata for a vendor project (organization, created date, etc.)."""
    __tablename__ = "project_metadata"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    organization = Column(String(255), nullable=True)
    created_date = Column(String(20), nullable=True)

    project = relationship("Project", back_populates="metadata_rel")


# ── Vendor ──────────────────────────────────────────────────────

class Vendor(Base):
    __tablename__ = "vendors"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(20), primary_key=True)  # e.g. "PP-001"
    sort_order = Column(Integer, nullable=False, default=0)

    name = Column(String(255), nullable=False, default="")
    legal_entity = Column(String(255), nullable=True, default="")
    country = Column(String(100), nullable=True, default="")
    sector = Column(String(255), nullable=True, default="")
    website = Column(String(500), nullable=True, default="")
    siret = Column(String(50), nullable=True, default="")
    status = Column(String(50), nullable=False, default="active")
    notes = Column(Text, nullable=True, default="")
    logo = Column(Text, nullable=True, default="")
    dpa_signed = Column(Boolean, nullable=False, default=False)

    # Nested objects stored as JSONB (not queried individually)
    contact = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    internal_contact = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    contract = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    classification = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    exposure = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    certifications = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    sub_contractors = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))

    # ── DORA RoI additive columns (EBA Reg. (EU) 2024/2956) ──
    # All optional; required only at RoI export time (validated by
    # dora_validation.validate_for_export). Standalone profile keeps
    # working with empty values.
    lei = Column(String(20), nullable=True)
    legal_name_latin = Column(String(255), nullable=True)
    person_type = Column(String(20), nullable=True)            # legal_person / natural_person
    entity_nature = Column(String(50), nullable=True)          # parent / subsidiary / branch / sole_entity
    additional_id_type = Column(String(50), nullable=True)
    additional_id_value = Column(String(100), nullable=True)
    additional_id_issuer = Column(String(255), nullable=True)
    ultimate_parent_id = Column(String(20), nullable=True)     # FK-soft to vendors.id within same project
    country_iso2 = Column(String(2), nullable=True)            # ISO-3166-1 alpha-2

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    project = relationship("Project", back_populates="vendors")
    measures = relationship("VendorMeasure", back_populates="vendor", cascade="all, delete-orphan", order_by="VendorMeasure.sort_order")

    __table_args__ = (
        Index("ix_vendors_project_status", "project_id", "status"),
        Index("ix_vendors_project_lei", "project_id", "lei"),
    )


# ── Vendor Measure ──────────────────────────────────────────────

class VendorMeasure(Base):
    __tablename__ = "vendor_measures"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    vendor_id = Column(String(20), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "PP-001-M01"
    sort_order = Column(Integer, nullable=False, default=0)

    mesure = Column(String(500), nullable=False, default="")
    details = Column(Text, nullable=True, default="")
    type = Column(String(100), nullable=True, default="")
    statut = Column(String(50), nullable=False, default="a_faire")
    responsable = Column(String(255), nullable=True, default="")
    echeance = Column(String(20), nullable=True, default="")
    ref_socle = Column(String(255), nullable=True, default="")
    effet = Column(Text, nullable=True, default="")

    # Provenance — set when a measure is materialised from a vendor's assessment
    # action plan (approval flow), so it links back to its origin gap.
    source = Column(String(50), nullable=True, default="")               # e.g. "vendor_engagement"
    source_assessment_id = Column(String(50), nullable=True, default="")
    source_question_id = Column(String(50), nullable=True, default="")

    progress_log = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    vendor = relationship("Vendor", back_populates="measures")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_vendor_measures_vendor", "project_id", "vendor_id"),
    )


# ── Vendor Risk ─────────────────────────────────────────────────

class VendorRisk(Base):
    __tablename__ = "vendor_risks"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "PP-001-R01"
    sort_order = Column(Integer, nullable=False, default=0)

    vendor_id = Column(String(20), nullable=False)
    title = Column(String(500), nullable=False, default="")
    description = Column(Text, nullable=True, default="")
    category = Column(String(50), nullable=True, default="")
    impact = Column(Integer, nullable=True)
    likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    status = Column(String(50), nullable=False, default="active")
    linked_measures = Column(Text, nullable=True, default="")

    # Nested treatment object as JSONB
    treatment = Column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    project = relationship("Project", back_populates="risks")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_vendor_risks_project_vendor", "project_id", "vendor_id"),
        Index("ix_vendor_risks_project_status", "project_id", "status"),
    )


# ── Vendor Document ─────────────────────────────────────────────

class VendorDocument(Base):
    __tablename__ = "vendor_documents"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "DOC-001"
    sort_order = Column(Integer, nullable=False, default=0)

    vendor_id = Column(String(20), nullable=False)
    name = Column(String(500), nullable=False, default="")
    type = Column(String(100), nullable=True, default="")
    url = Column(String(1000), nullable=True, default="")
    expiry_date = Column(String(20), nullable=True, default="")
    source = Column(String(100), nullable=True, default="")
    verified = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    project = relationship("Project", back_populates="documents")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_vendor_documents_project_vendor", "project_id", "vendor_id"),
    )


# ── Vendor Assessment ───────────────────────────────────────────

class VendorAssessment(Base):
    __tablename__ = "vendor_assessments"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "ASS-001"
    sort_order = Column(Integer, nullable=False, default=0)

    vendor_id = Column(String(20), nullable=False)
    title = Column(String(500), nullable=False, default="")
    status = Column(String(50), nullable=False, default="draft")
    date = Column(String(20), nullable=True, default="")
    score = Column(Float, nullable=True)
    assessor = Column(String(255), nullable=True, default="")

    # Questionnaire responses stored as JSONB (complex nested structure)
    responses = Column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))

    # ── Phase 0b fields (template-driven assessments) ──
    # See src/assessment_validation.py for the full data contract and
    # the immutability/validation rules enforced server-side.
    type = Column(String(30), nullable=True, default="periodic")  # periodic / onboarding / exceptional / audit
    due_date = Column(String(20), nullable=True, default="")
    template_id = Column(String(30), nullable=True)
    template_version = Column(Integer, nullable=True)
    template_snapshot = Column(JSONB, nullable=True)  # IMMUTABLE after creation (R1)
    self_validation = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    self_validated_at = Column(String(40), nullable=True)
    submitted_at = Column(String(40), nullable=True)  # server-assigned
    approved_at = Column(String(40), nullable=True)   # server-assigned
    approved_by = Column(String(255), nullable=True)  # server-assigned
    rejected_reason = Column(Text, nullable=True)
    completion_rate = Column(Integer, nullable=True, default=0)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    project = relationship("Project", back_populates="assessments")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_vendor_assessments_project_vendor", "project_id", "vendor_id"),
    )


# ─────────────────────────────────────────────────────────────────
# DORA Register of Information — EBA Reg. (EU) 2024/2956
# Granular per-entity persistence. Single source of truth for the
# RoI data model. Mutated only via routes/dora.py (POST/PATCH/DELETE
# per entity), NEVER via the legacy projects blob PUT.
# See src/dora_validation.py for R-numbered rules.
# ─────────────────────────────────────────────────────────────────


class DoraEntity(Base):
    """Reporting Financial Entity (RFE). One per project minimum.
    Multiple in case of consolidated reporting."""
    __tablename__ = "dora_entities"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(50), primary_key=True)  # e.g. "RFE-001" (user-editable, EBA RoI compatible)
    sort_order = Column(Integer, nullable=False, default=0)

    lei = Column(String(20), nullable=False)
    name = Column(String(255), nullable=False, default="")
    country_iso2 = Column(String(2), nullable=False, default="")
    competent_authority = Column(String(255), nullable=True, default="")
    entity_type = Column(String(50), nullable=True, default="")        # credit_institution, payment_institution, ...
    hierarchy = Column(String(50), nullable=True, default="")          # parent / subsidiary / sole_entity
    parent_lei = Column(String(20), nullable=True)
    total_assets = Column(Float, nullable=True)
    total_assets_currency = Column(String(3), nullable=True, default="EUR")  # B_01.02.0100 ISO-4217
    reporting_period = Column(String(10), nullable=True, default="")   # YYYY-12-31

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    __table_args__ = (
        Index("ix_dora_entities_project_lei", "project_id", "lei"),
    )


class DoraFunction(Base):
    """B_02.02 — Functions of the RFE. Linked to DoraArrangement via DoraArrangementFunction (m:n)."""
    __tablename__ = "dora_functions"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(50), primary_key=True)  # internal id, e.g. "FN-XXXXXX"
    sort_order = Column(Integer, nullable=False, default=0)

    code = Column(String(50), nullable=True, default="")  # B_06.01.0010 user-editable function code (falls back to id when empty)
    name = Column(String(255), nullable=False, default="")
    description = Column(Text, nullable=True, default="")
    is_critical_or_important = Column(Boolean, nullable=False, default=False)
    criticality_rationale = Column(Text, nullable=True, default="")
    business_line = Column(String(255), nullable=True, default="")
    lou_code = Column(String(50), nullable=True, default="")
    recovery_time_objective_h = Column(Float, nullable=True)
    recovery_point_objective_h = Column(Float, nullable=True)
    impact_tolerance_description = Column(Text, nullable=True, default="")
    last_assessment_date = Column(String(10), nullable=True)  # B_06.01.0070 — YYYY-MM-DD

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))


class DoraBranch(Base):
    """B_01.03 — Branches of an RFE."""
    __tablename__ = "dora_branches"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(50), primary_key=True)  # e.g. "BR-001" (user-editable, EBA RoI compatible)
    rfe_id = Column(String(50), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)

    name = Column(String(255), nullable=True, default="")
    country_iso2 = Column(String(2), nullable=False, default="")
    lei = Column(String(20), nullable=True)
    branch_code = Column(String(50), nullable=True, default="")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "rfe_id"],
            ["dora_entities.project_id", "dora_entities.id"],
            ondelete="CASCADE",
        ),
        Index("ix_dora_branches_rfe", "project_id", "rfe_id"),
    )


class DoraConsolidationScope(Base):
    """B_01.01 / B_01.02 — Entities in the consolidation perimeter."""
    __tablename__ = "dora_consolidation_scope"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(20), primary_key=True)  # e.g. "CS-001"
    sort_order = Column(Integer, nullable=False, default=0)

    entity_lei = Column(String(20), nullable=False)
    entity_name = Column(String(255), nullable=True, default="")
    relation_to_rfe = Column(String(50), nullable=True, default="")    # parent / subsidiary / branch / joint_venture
    inclusion_method = Column(String(30), nullable=True, default="")   # full / proportional / equity_method
    country_iso2 = Column(String(2), nullable=True, default="")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))


class DoraArrangement(Base):
    """B_03.02 — ICT contractual arrangement header. One per contract."""
    __tablename__ = "dora_arrangements"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "ARR-001"
    vendor_id = Column(String(20), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)

    arrangement_reference = Column(String(100), nullable=False, default="")  # unique per project
    arrangement_type = Column(String(50), nullable=True, default="")          # B.02.01.0020: standalone | overarching | subsequent
    is_critical_function_support = Column(Boolean, nullable=False, default=False)  # derived server-side from linked functions
    start_date = Column(String(10), nullable=True, default="")                # YYYY-MM-DD
    end_date = Column(String(10), nullable=True, default="")
    notice_period_days = Column(Integer, nullable=True)
    governing_law_country = Column(String(2), nullable=True, default="")
    jurisdiction_country = Column(String(2), nullable=True, default="")
    annual_cost_amount = Column(Float, nullable=True)                          # multi-currency: stored in `currency`
    currency = Column(String(3), nullable=True, default="EUR")                 # ISO-4217
    nature_of_service = Column(Text, nullable=True, default="")
    data_sensitivity = Column(String(50), nullable=True, default="")           # public/internal/confidential/pii/special_pii
    data_storage_country = Column(String(2), nullable=True, default="")
    data_processing_country = Column(String(2), nullable=True, default="")
    # ITS B.07.01 substitutability + exit fields
    substitutability_level = Column(String(30), nullable=True, default="")     # B.07.01.0050: not_substitutable | highly_complex | medium_complexity | easy
    substitutability_reason = Column(String(30), nullable=True, default="")    # B.07.01.0060: no_alternatives | migration_difficulties | both (required iff level in {not_substitutable, highly_complex})
    reintegration_level = Column(String(30), nullable=True, default="")        # B.07.01.0090: easy | difficult | highly_complex
    exit_strategy_documented = Column(Boolean, nullable=False, default=False)  # B.07.01.0080
    # Legacy boolean fields (kept for back-compat — derived from the level fields above)
    is_substitutable = Column(Boolean, nullable=False, default=False)
    reintegration_possible = Column(Boolean, nullable=False, default=False)
    last_audit_date = Column(String(10), nullable=True, default="")
    # Migration 011 — EBA RoI completeness
    reliance_level = Column(String(30), nullable=True)                # B_02.02.0180: not_significant | low | material | full
    impact_discontinuing_level = Column(String(30), nullable=True)    # B_07.01.0100: low | medium | high | not_assessed
    alternative_tpp_id = Column(String(200), nullable=True)           # B_07.01.0110: free identifier of the alternative TPSP
    notice_period_tpsp_days = Column(Integer, nullable=True)          # B_02.02.0110: TPSP-side notice period
    termination_reason = Column(String(30), nullable=True)            # B_02.02.0090: expired_not_renewed | breach_of_law | impediments | data_security_weakness | competent_authority | other
    parent_arrangement_id = Column(String(30), nullable=True)         # B_02.01.0030: reference of the overarching arrangement

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "vendor_id"],
            ["vendors.project_id", "vendors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_dora_arrangements_vendor", "project_id", "vendor_id"),
        Index("ix_dora_arrangements_ref", "project_id", "arrangement_reference", unique=True),
    )


class DoraArrangementService(Base):
    """Junction Service × Arrangement.

    An ICT contractual arrangement may cover multiple types of ICT
    services (eba_TA codes). The export emits one B_02.02 row per
    (arrangement × RFE × function × service_code) combination.
    """
    __tablename__ = "dora_arrangement_services"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    arrangement_id = Column(String(30), primary_key=True)
    service_code = Column(String(10), primary_key=True)  # S_01..S_21 from codelists.json

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
    )


class DoraArrangementFunction(Base):
    """Junction Function × Arrangement (one arrangement may support multiple functions)."""
    __tablename__ = "dora_arrangement_functions"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    arrangement_id = Column(String(30), primary_key=True)
    function_id = Column(String(50), primary_key=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "function_id"],
            ["dora_functions.project_id", "dora_functions.id"],
            ondelete="CASCADE",
        ),
    )


class DoraArrangementRfe(Base):
    """Junction RFE × Arrangement (one arrangement may cover multiple RFEs of a group)."""
    __tablename__ = "dora_arrangement_rfes"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    arrangement_id = Column(String(30), primary_key=True)
    rfe_id = Column(String(50), primary_key=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "rfe_id"],
            ["dora_entities.project_id", "dora_entities.id"],
            ondelete="CASCADE",
        ),
    )


class DoraSigner(Base):
    """B_03.03 — Entities that legally signed the arrangement."""
    __tablename__ = "dora_signers"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    arrangement_id = Column(String(30), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "SIG-001"
    sort_order = Column(Integer, nullable=False, default=0)

    signer_lei = Column(String(20), nullable=True)
    signer_name = Column(String(255), nullable=False, default="")
    signer_role = Column(String(30), nullable=True, default="")  # tpp / rfe / intermediary
    signed_on = Column(String(10), nullable=True, default="")    # YYYY-MM-DD

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
    )


class DoraSubcontractor(Base):
    """B_05.01 — Subcontractor legal entity (project-global identity).

    Per-link attributes (tier, service_provided, is_critical_function_support,
    parent_subcontractor_id, data_country) live on
    ``DoraArrangementSubcontractor`` so the same legal entity can be
    linked to several arrangements (potentially across vendors) with
    different roles.
    """
    __tablename__ = "dora_subcontractors"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    id = Column(String(30), primary_key=True)  # e.g. "SUB-001"
    sort_order = Column(Integer, nullable=False, default=0)

    lei = Column(String(20), nullable=True)
    name = Column(String(255), nullable=False, default="")
    country_iso2 = Column(String(2), nullable=True, default="")
    sector = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))


class DoraArrangementSubcontractor(Base):
    """Junction between an arrangement and a subcontractor.

    Carries the per-link RoI fields (B_05.01 / B_05.02). The same
    ``subcontractor_id`` may appear under multiple arrangements with
    different ``tier``/``service_provided``/criticality.
    """
    __tablename__ = "dora_arrangement_subcontractors"

    project_id = Column(UUID(as_uuid=True), primary_key=True)
    arrangement_id = Column(String(30), primary_key=True)
    subcontractor_id = Column(String(30), primary_key=True)

    sort_order = Column(Integer, nullable=False, default=0)
    tier = Column(Integer, nullable=False, default=1)
    service_provided = Column(Text, nullable=True, default="")
    is_critical_function_support = Column(Boolean, nullable=False, default=False)
    parent_subcontractor_id = Column(String(30), nullable=True)
    data_country = Column(String(2), nullable=True, default="")

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), server_default=text("NOW()"))

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "arrangement_id"],
            ["dora_arrangements.project_id", "dora_arrangements.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_id", "subcontractor_id"],
            ["dora_subcontractors.project_id", "dora_subcontractors.id"],
            ondelete="CASCADE",
        ),
        Index("ix_dora_arrangement_subcontractors_arr_tier", "project_id", "arrangement_id", "tier"),
        Index("ix_dora_arrangement_subcontractors_sub", "project_id", "subcontractor_id"),
    )





# ── Append-only server-side write journal (FEAT-30 P1.6) ──────────────
# Created by Base.metadata.create_all at startup (no migration needed for
# a new table). Written via src.audit.log_write — see audit_common master.
class AuditLog(Base):
    """Append-only: never UPDATEd/DELETEd (retention purge excepted).
    entity_type/entity_id tie a line to the exact restorable object."""
    __tablename__ = "audit_log"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))
    logged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=text("NOW()"), index=True)
    user_email = Column(String(255), nullable=False, default="")
    user_name = Column(String(255), nullable=False, default="")
    action = Column(String(100), nullable=False, index=True)
    target = Column(String(500), nullable=False, default="")
    entity_type = Column(String(50), nullable=False, default="")
    entity_id = Column(String(64), nullable=False, default="", index=True)
    details = Column(Text, nullable=False, default="")
    ip_address = Column(String(64), nullable=False, default="")
