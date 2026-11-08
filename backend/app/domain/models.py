from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..infrastructure.database import Base


def uid() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Project(Timestamped, Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200))
    creation_mode: Mapped[str] = mapped_column(String(24))  # adaptation | original
    status: Mapped[str] = mapped_column(String(24), default="active")
    genre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    target_episodes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    aspect_ratio: Mapped[str] = mapped_column(String(16), default="16:9")
    rights_status: Mapped[str] = mapped_column(String(32), default="unconfirmed")
    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    stages: Mapped[list["StageState"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Chapter(Timestamped, Base):
    __tablename__ = "chapters"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    source_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    project: Mapped[Project] = relationship(back_populates="chapters")
    __table_args__ = (
        UniqueConstraint("project_id", "ordinal", "version", name="uq_chapter_version"),
    )


class CharacterReference(Timestamped, Base):
    __tablename__ = "character_references"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    immutable_features: Mapped[str] = mapped_column(Text)
    costume_rules: Mapped[str] = mapped_column(Text)
    reference_views: Mapped[list[str]] = mapped_column(
        JSON,
        default=lambda: ["front_full_body", "side_full_body", "back_full_body", "expression_sheet"],
    )
    status: Mapped[str] = mapped_column(String(24), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)


class CreativeBrief(Timestamped, Base):
    __tablename__ = "creative_briefs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), unique=True, index=True
    )
    premise: Mapped[str] = mapped_column(Text)
    genre: Mapped[str] = mapped_column(String(200))
    target_readers: Mapped[str] = mapped_column(Text)
    narrative_pov: Mapped[str] = mapped_column(String(200))
    planned_scope: Mapped[str] = mapped_column(String(300))
    style_baseline: Mapped[str] = mapped_column(Text)
    constraints: Mapped[str] = mapped_column(Text, default="")
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="draft")


class CommercialBrief(Timestamped, Base):
    __tablename__ = "commercial_briefs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), unique=True, index=True
    )
    product_name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(200))
    product_facts: Mapped[str] = mapped_column(Text)
    target_audience: Mapped[str] = mapped_column(Text)
    selling_points: Mapped[list[str]] = mapped_column(JSON, default=list)
    approved_claims: Mapped[list[str]] = mapped_column(JSON, default=list)
    prohibited_claims: Mapped[list[str]] = mapped_column(JSON, default=list)
    call_to_action: Mapped[str] = mapped_column(String(500))
    distribution_channel: Mapped[str] = mapped_column(String(200))
    target_seconds: Mapped[int] = mapped_column(Integer, default=30)
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="draft")


class CommercialMaterial(Timestamped, Base):
    __tablename__ = "commercial_materials"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    original_name: Mapped[str] = mapped_column(String(300))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    media_kind: Mapped[str] = mapped_column(String(24))
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    rights_status: Mapped[str] = mapped_column(String(24))


class StageState(Timestamped, Base):
    __tablename__ = "stage_states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    stage_key: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="not_started")
    version: Mapped[int] = mapped_column(Integer, default=0)
    stale: Mapped[bool] = mapped_column(Boolean, default=False)
    decision: Mapped[dict] = mapped_column(JSON, default=dict)
    project: Mapped[Project] = relationship(back_populates="stages")
    __table_args__ = (UniqueConstraint("project_id", "stage_key", name="uq_project_stage"),)


class ServiceProfile(Timestamped, Base):
    __tablename__ = "service_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    modality: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(120))
    adapter_id: Mapped[str] = mapped_column(String(80))
    transport: Mapped[str] = mapped_column(String(24))
    endpoint: Mapped[str] = mapped_column(String(500))
    model_id: Mapped[str] = mapped_column(String(200))
    secret_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)


class GenerationJob(Timestamped, Base):
    __tablename__ = "generation_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    modality: Mapped[str] = mapped_column(String(16))
    stage_key: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(200))
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("project_id", "idempotency_key", name="uq_job_idempotency"),)


class GenerationOutput(Timestamped, Base):
    __tablename__ = "generation_outputs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[str] = mapped_column(
        ForeignKey("generation_jobs.id", ondelete="CASCADE"), unique=True, index=True
    )
    content_type: Mapped[str] = mapped_column(String(120), default="text/plain")
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class GenerationOutputVersion(Base):
    __tablename__ = "generation_output_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    output_id: Mapped[str] = mapped_column(
        ForeignKey("generation_outputs.id", ondelete="CASCADE"), index=True
    )
    revision: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (
        UniqueConstraint("output_id", "revision", name="uq_generation_output_revision"),
    )


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(80))
    entity_ref: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
