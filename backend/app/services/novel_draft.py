from pydantic import ValidationError

from ..domain.contracts import NovelChapterDraftCandidate


class NovelDraftCandidateError(ValueError):
    """Raised when a model response is not a valid chapter candidate."""


def parse_chapter_candidate(content: str, expected_ordinal: int) -> NovelChapterDraftCandidate:
    try:
        candidate = NovelChapterDraftCandidate.model_validate_json(content)
    except ValidationError as error:
        raise NovelDraftCandidateError(
            "候选必须是包含 ordinal、title、body 的有效 JSON。"
        ) from error
    if candidate.ordinal != expected_ordinal:
        raise NovelDraftCandidateError("候选章节序号与本次任务范围不一致。")
    return candidate
