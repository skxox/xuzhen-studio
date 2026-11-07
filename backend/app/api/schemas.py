from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    creation_mode: Literal["adaptation", "original"]
    genre: str | None = None
    target_episodes: int | None = Field(default=None, ge=1, le=500)
    episode_seconds: int | None = Field(default=None, ge=10, le=7200)
    aspect_ratio: str = "16:9"
    rights_status: Literal["unconfirmed", "owned", "licensed", "public_domain", "restricted"] = "unconfirmed"


class ChapterCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    ordinal: int = Field(ge=1)
    source_name: str | None = None


class ServiceProfileCreate(BaseModel):
    modality: Literal["text", "image", "video", "audio"]
    name: str = Field(min_length=1, max_length=120)
    adapter_id: str
    transport: Literal["remote_api", "self_hosted_api", "local_runtime"]
    endpoint: HttpUrl
    model_id: str
    secret_ref: str | None = None
    capabilities: dict = Field(default_factory=dict)


class GateDecision(BaseModel):
    action: Literal["accept", "waive", "reject"]
    reason: str | None = None
    risk_ack: bool = False


class JobCreate(BaseModel):
    modality: Literal["text", "image", "video", "audio"]
    stage_key: str
    profile_id: str
    idempotency_key: str = Field(min_length=8, max_length=200)
    prompt: str = Field(min_length=1)
    parameters: dict = Field(default_factory=dict)
    input_refs: list[str] = Field(default_factory=list)
