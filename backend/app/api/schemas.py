from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    creation_mode: Literal["adaptation", "original", "commercial"]
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


class CharacterReferenceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    immutable_features: str = Field(min_length=1, max_length=2000)
    costume_rules: str = Field(min_length=1, max_length=1200)

    @field_validator("name", "immutable_features", "costume_rules", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CreativeBriefSave(BaseModel):
    premise: str = Field(min_length=1, max_length=3000)
    genre: str = Field(min_length=1, max_length=200)
    target_readers: str = Field(min_length=1, max_length=1000)
    narrative_pov: str = Field(min_length=1, max_length=200)
    planned_scope: str = Field(min_length=1, max_length=300)
    style_baseline: str = Field(min_length=1, max_length=3000)
    constraints: str = Field(default="", max_length=3000)
    rights_confirmed: bool = False

    @field_validator(
        "premise",
        "genre",
        "target_readers",
        "narrative_pov",
        "planned_scope",
        "style_baseline",
        "constraints",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CommercialBriefSave(BaseModel):
    product_name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=200)
    product_facts: str = Field(min_length=1, max_length=5000)
    target_audience: str = Field(min_length=1, max_length=2000)
    selling_points: list[str] = Field(min_length=1, max_length=12)
    approved_claims: list[str] = Field(default_factory=list, max_length=20)
    prohibited_claims: list[str] = Field(default_factory=list, max_length=20)
    call_to_action: str = Field(min_length=1, max_length=500)
    distribution_channel: str = Field(min_length=1, max_length=200)
    target_seconds: int = Field(ge=5, le=600)
    rights_confirmed: bool = False

    @field_validator(
        "product_name", "category", "product_facts", "target_audience", "call_to_action", "distribution_channel",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("selling_points", "approved_claims", "prohibited_claims", mode="before")
    @classmethod
    def normalize_lists(cls, value: object) -> object:
        if isinstance(value, list):
            return [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return value


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
