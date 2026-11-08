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
