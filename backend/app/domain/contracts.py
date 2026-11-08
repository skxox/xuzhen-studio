from pydantic import BaseModel, ConfigDict, Field, field_validator


class NovelChapterDraftCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ordinal: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=2_000_000)

    @field_validator("title", "body", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value
