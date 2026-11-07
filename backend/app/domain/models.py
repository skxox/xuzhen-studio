from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..infrastructure.database import Base


def uid() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


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
    chapters: Mapped[list["Chapter"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    stages: Mapped[list["StageState"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Chapter(Timestamped, Base):
    __tablename__ = "chapters"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    source_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    project: Mapped[Project] = relationship(back_populates="chapters")
    __table_args__ = (UniqueConstraint("project_id", "ordinal", "version", name="uq_chapter_version"),)


class CharacterReference(Timestamped, Base):
    __tablename__ = "character_references"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    immutable_features: Mapped[str] = mapped_column(Text)
    costume_rules: Mapped[str] = mapped_column(Text)
    reference_views: Mapped[list[str]] = mapped_column(JSON, default=lambda: [
        "front_full_body", "side_full_body", "back_full_body", "expression_sheet"
    ])
    status: Mapped[str] = mapped_column(String(24), default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1)


class StageState(Timestamped, Base):
    __tablename__ = "stage_states"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
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
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
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
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    modality: Mapped[str] = mapped_column(String(16))
    stage_key: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="queued")
    idempotency_key: Mapped[str] = mapped_column(String(200))
    input_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (UniqueConstraint("project_id", "idempotency_key", name="uq_job_idempotency"),)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(80))
    entity_ref: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
