from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class NovelChapterDraftCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ordinal: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=2_000_000)

    @field_validator("title", "body", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ContinuityFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: str = Field(min_length=1, max_length=60, pattern=r"^[a-zA-Z0-9_-]+$")
    category: Literal[
        "character_fact",
        "timeline",
        "world_rule",
        "causality",
        "viewpoint",
        "setup_payoff",
        "other",
    ]
    severity: Literal["high", "medium", "low"]
    chapter_ordinal: int = Field(ge=1)
    evidence_quote: str = Field(min_length=1, max_length=800)
    related_chapter_ordinal: int | None = Field(default=None, ge=1)
    related_evidence_quote: str | None = Field(default=None, max_length=800)
    issue: str = Field(min_length=1, max_length=2000)
    recommendation: str = Field(min_length=1, max_length=2000)
    status: Literal["open", "resolved", "accepted_risk"] = "open"
    resolution_note: str = Field(default="", max_length=1000)

    @field_validator(
        "evidence_quote",
        "related_evidence_quote",
        "issue",
        "recommendation",
        "resolution_note",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_related_evidence(self):
        if bool(self.related_chapter_ordinal) != bool(self.related_evidence_quote):
            raise ValueError("related evidence requires both a chapter ordinal and a quote")
        if self.related_evidence_quote is not None and not self.related_evidence_quote.strip():
            raise ValueError("related evidence quote cannot be empty")
        return self


class ContinuityReportCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chapter_start: int = Field(ge=1)
    chapter_end: int = Field(ge=1)
    findings: list[ContinuityFinding] = Field(default_factory=list, max_length=200)


class EpisodeSourceMappingCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1)
    chapter_ordinals: list[int] = Field(min_length=1, max_length=200)
    target: str = Field(min_length=1, max_length=1200)
    conflict: str = Field(min_length=1, max_length=1200)
    turn: str = Field(min_length=1, max_length=1200)
    ending_hook: str = Field(min_length=1, max_length=1000)
    preserve_facts: str = Field(min_length=1, max_length=2000)
    allowed_changes: str = Field(min_length=1, max_length=2000)
    adaptation_note: str = Field(min_length=1, max_length=2000)

    @field_validator(
        "target",
        "conflict",
        "turn",
        "ending_hook",
        "preserve_facts",
        "allowed_changes",
        "adaptation_note",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class EpisodeSourceMappingPlanCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_id: str = Field(min_length=36, max_length=36)
    episode_count: int = Field(ge=1, le=500)
    episode_seconds: int = Field(ge=10, le=7200)
    aspect_ratio: str = Field(min_length=1, max_length=16)
    episodes: list[EpisodeSourceMappingCandidate] = Field(min_length=1, max_length=500)


class AdaptationBeatCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beat_number: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=1000)
    turn: str = Field(min_length=1, max_length=1000)

    @field_validator("action", "turn", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdaptationSceneCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1)
    slugline: str = Field(min_length=1, max_length=300)
    location: str = Field(min_length=1, max_length=200)
    time_of_day: str = Field(min_length=1, max_length=100)
    character_names: list[str] = Field(min_length=1, max_length=20)
    purpose: str = Field(min_length=1, max_length=1200)
    conflict: str = Field(min_length=1, max_length=1200)
    estimated_seconds: int = Field(ge=1, le=7200)
    source_chapter_ordinals: list[int] = Field(default_factory=list, max_length=200)
    is_adaptation_addition: bool = False
    beats: list[AdaptationBeatCandidate] = Field(min_length=2, max_length=12)

    @field_validator(
        "slugline",
        "location",
        "time_of_day",
        "purpose",
        "conflict",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("character_names", mode="before")
    @classmethod
    def normalize_characters(cls, value: object) -> object:
        if isinstance(value, list):
            return [item.strip() for item in value if isinstance(item, str) and item.strip()]
        return value


class EpisodeAdaptationOutlineCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1)
    source_chapter_ordinals: list[int] = Field(min_length=1, max_length=200)
    adaptation_summary: str = Field(min_length=1, max_length=2000)
    emotional_arc: str = Field(min_length=1, max_length=1200)
    ending_hook: str = Field(min_length=1, max_length=1000)
    scenes: list[AdaptationSceneCandidate] = Field(min_length=1, max_length=30)

    @field_validator("adaptation_summary", "emotional_arc", "ending_hook", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdaptationOutlineCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branch_id: str = Field(min_length=36, max_length=36)
    release_id: str = Field(min_length=36, max_length=36)
    episode_count: int = Field(ge=1, le=500)
    episode_seconds: int = Field(ge=10, le=7200)
    aspect_ratio: str = Field(min_length=1, max_length=16)
    creative_thesis: str = Field(min_length=1, max_length=2000)
    episodes: list[EpisodeAdaptationOutlineCandidate] = Field(min_length=1, max_length=500)

    @field_validator("creative_thesis", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ScriptDialogueCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dialogue_number: int = Field(ge=1)
    speaker: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=3000)
    emotion: str = Field(min_length=1, max_length=120)
    delivery: str = Field(min_length=1, max_length=240)
    estimated_seconds: int = Field(ge=1, le=180)
    source_chapter_ordinals: list[int] = Field(default_factory=list, max_length=200)
    origin: Literal["direct_quote", "adaptation", "original"]

    @field_validator("speaker", "text", "emotion", "delivery", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ScriptSceneCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_number: int = Field(ge=1)
    action: str = Field(min_length=1, max_length=8000)
    action_seconds: int = Field(ge=0, le=7200)
    dialogues: list[ScriptDialogueCandidate] = Field(default_factory=list, max_length=60)

    @field_validator("action", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class EpisodeScriptCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_number: int = Field(ge=1)
    scenes: list[ScriptSceneCandidate] = Field(min_length=1, max_length=30)


class ScriptCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branch_id: str = Field(min_length=36, max_length=36)
    release_id: str = Field(min_length=36, max_length=36)
    outline_release_id: str = Field(min_length=36, max_length=36)
    character_job_id: str = Field(min_length=36, max_length=36)
    art_job_id: str = Field(min_length=36, max_length=36)
    episode_count: int = Field(ge=1, le=500)
    episodes: list[EpisodeScriptCandidate] = Field(min_length=1, max_length=500)
