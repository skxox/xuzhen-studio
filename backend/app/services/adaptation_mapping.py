from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.contracts import EpisodeSourceMappingPlanCandidate
from ..domain.models import Chapter, ManuscriptRelease, Project, StageState


class EpisodeSourceMappingError(ValueError):
    """Raised when an episode source map is incomplete or outside its release scope."""


def current_release_chapters(
    db: Session, project: Project, release_id: str
) -> tuple[ManuscriptRelease, list[Chapter]]:
    release_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "manuscriptRelease",
        )
    )
    if (
        project.creation_mode != "original"
        or project.rights_status == "unconfirmed"
        or not release_stage
        or release_stage.status != "accepted"
        or (release_stage.decision or {}).get("release_id") != release_id
    ):
        raise EpisodeSourceMappingError("必须使用当前有效且权利状态已确认的原创稿锁版。")
    release = db.scalar(
        select(ManuscriptRelease).where(
            ManuscriptRelease.id == release_id,
            ManuscriptRelease.project_id == project.id,
        )
    )
    if not release or release.rights_status == "unconfirmed":
        raise EpisodeSourceMappingError("原创稿锁版不存在或权利状态未确认。")
    chapters = [
        db.scalar(
            select(Chapter).where(
                Chapter.id == item["chapter_id"],
                Chapter.project_id == project.id,
                Chapter.ordinal == item["ordinal"],
                Chapter.version == item["version"],
                Chapter.content_hash == item["content_hash"],
            )
        )
        for item in release.chapter_versions
    ]
    if any(chapter is None for chapter in chapters):
        raise EpisodeSourceMappingError("锁版引用的章节版本缺失，需重新完成连续性审校和锁版。")
    return release, chapters


def parse_episode_source_mapping(
    content: str,
    *,
    expected_release_id: str,
    expected_episode_count: int,
    expected_episode_seconds: int,
    expected_aspect_ratio: str,
    allowed_chapter_ordinals: set[int],
) -> EpisodeSourceMappingPlanCandidate:
    try:
        plan = EpisodeSourceMappingPlanCandidate.model_validate_json(content)
    except ValidationError as error:
        raise EpisodeSourceMappingError("逐集章节映射格式无效，请检查候选字段。") from error
    if plan.release_id != expected_release_id:
        raise EpisodeSourceMappingError("映射候选引用的原创稿版本与当前任务不一致。")
    if (
        plan.episode_count != expected_episode_count
        or plan.episode_seconds != expected_episode_seconds
        or plan.aspect_ratio != expected_aspect_ratio
    ):
        raise EpisodeSourceMappingError("映射候选的集数或制作参数与本次任务不一致。")
    if len(plan.episodes) != expected_episode_count:
        raise EpisodeSourceMappingError("映射行数必须与目标集数完全一致。")
    expected_episode_numbers = list(range(1, expected_episode_count + 1))
    if [item.episode_number for item in plan.episodes] != expected_episode_numbers:
        raise EpisodeSourceMappingError("目标集序必须从第 1 集开始连续且不重复。")
    assigned_ordinals = [
        ordinal for episode in plan.episodes for ordinal in episode.chapter_ordinals
    ]
    if len(assigned_ordinals) != len(set(assigned_ordinals)):
        raise EpisodeSourceMappingError("同一原文章节不能重复分配到多个目标集。")
    if set(assigned_ordinals) != allowed_chapter_ordinals:
        raise EpisodeSourceMappingError("映射必须完整覆盖锁版范围内的章节，且不能引用范围外章节。")
    next_ordinal = min(allowed_chapter_ordinals)
    for episode in plan.episodes:
        ordered_ordinals = sorted(episode.chapter_ordinals)
        if episode.chapter_ordinals != ordered_ordinals:
            raise EpisodeSourceMappingError("每集章节序号必须按原文顺序排列。")
        if ordered_ordinals != list(range(next_ordinal, ordered_ordinals[-1] + 1)):
            raise EpisodeSourceMappingError("每集章节必须连续，且目标集必须保持原文顺序。")
        next_ordinal = ordered_ordinals[-1] + 1
    return plan
