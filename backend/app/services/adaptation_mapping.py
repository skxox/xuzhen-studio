from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.contracts import AdaptationOutlineCandidate, EpisodeSourceMappingPlanCandidate
from ..domain.models import (
    AdaptationBranch,
    Chapter,
    EpisodeSourceMapping,
    ManuscriptRelease,
    Project,
    StageState,
)


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


def current_adaptation_branch(
    db: Session, project: Project
) -> tuple[AdaptationBranch, list[EpisodeSourceMapping]]:
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "source",
        )
    )
    branch_id = (
        (stage.decision or {}).get("branch_id") if stage and stage.status == "accepted" else None
    )
    branch = db.scalar(
        select(AdaptationBranch).where(
            AdaptationBranch.id == branch_id,
            AdaptationBranch.project_id == project.id,
        )
    )
    if not branch:
        raise EpisodeSourceMappingError("必须先验收当前改编分支。")
    _, chapters = current_release_chapters(db, project, branch.release_id)
    mappings = db.scalars(
        select(EpisodeSourceMapping)
        .where(EpisodeSourceMapping.branch_id == branch.id)
        .order_by(EpisodeSourceMapping.episode_number)
    ).all()
    if len(mappings) != branch.episode_count:
        raise EpisodeSourceMappingError("当前改编分支的逐集映射记录不完整。")
    allowed_ordinals = {chapter.ordinal for chapter in chapters}
    if any(not set(mapping.chapter_ordinals).issubset(allowed_ordinals) for mapping in mappings):
        raise EpisodeSourceMappingError("当前改编分支包含不属于锁版范围的章节。")
    return branch, mappings


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
    if not allowed_chapter_ordinals:
        raise EpisodeSourceMappingError("锁版中没有可映射章节。")
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


def parse_adaptation_outline(
    content: str,
    *,
    branch_id: str,
    release_id: str,
    episode_seconds: int,
    aspect_ratio: str,
    mappings: list[dict],
) -> AdaptationOutlineCandidate:
    try:
        outline = AdaptationOutlineCandidate.model_validate_json(content)
    except ValidationError as error:
        raise EpisodeSourceMappingError("视频改编大纲格式无效，请检查候选字段。") from error
    expected_numbers = list(range(1, len(mappings) + 1))
    if (
        outline.branch_id != branch_id
        or outline.release_id != release_id
        or outline.episode_count != len(mappings)
        or outline.episode_seconds != episode_seconds
        or outline.aspect_ratio != aspect_ratio
    ):
        raise EpisodeSourceMappingError("大纲候选引用的改编分支或制作参数已变化。")
    if [episode.episode_number for episode in outline.episodes] != expected_numbers:
        raise EpisodeSourceMappingError("大纲必须逐集覆盖当前分支，集序不得缺失或重复。")
    for episode, mapping in zip(outline.episodes, mappings, strict=True):
        allowed_sources = set(mapping["chapter_ordinals"])
        if episode.source_chapter_ordinals != mapping["chapter_ordinals"]:
            raise EpisodeSourceMappingError(
                f"第 {episode.episode_number} 集的大纲来源必须与已接受映射一致。"
            )
        scene_numbers = [scene.scene_number for scene in episode.scenes]
        if scene_numbers != list(range(1, len(episode.scenes) + 1)):
            raise EpisodeSourceMappingError(f"第 {episode.episode_number} 集的场次序号必须连续。")
        total_seconds = 0
        for scene in episode.scenes:
            total_seconds += scene.estimated_seconds
            if scene.source_chapter_ordinals != sorted(set(scene.source_chapter_ordinals)):
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场的章节来源需去重"
                    "并按原文顺序排列。"
                )
            if not set(scene.source_chapter_ordinals).issubset(allowed_sources):
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集含有超出映射范围的章节引用。"
                )
            if not scene.source_chapter_ordinals and not scene.is_adaptation_addition:
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集存在无原文出处且未标记新增的场次。"
                )
            if scene.source_chapter_ordinals and scene.is_adaptation_addition:
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场标记为纯新增，"
                    "却仍引用了原文。"
                )
            if [beat.beat_number for beat in scene.beats] != list(range(1, len(scene.beats) + 1)):
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场的节拍序号必须连续。"
                )
        if total_seconds > episode_seconds:
            raise EpisodeSourceMappingError(
                f"第 {episode.episode_number} 集场次时长预算超过单集目标时长。"
            )
    return outline
