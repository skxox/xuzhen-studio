from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.contracts import (
    AdaptationOutlineCandidate,
    EpisodeSourceMappingPlanCandidate,
    ScriptCandidate,
    StoryboardPlanCandidate,
)
from ..domain.models import (
    AdaptationBranch,
    AdaptationOutlineRelease,
    Chapter,
    EpisodeAdaptationOutline,
    EpisodeSourceMapping,
    GenerationJob,
    GenerationOutput,
    ManuscriptRelease,
    Project,
    ScriptRelease,
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


def current_adaptation_script_context(
    db: Session, project: Project
) -> tuple[
    AdaptationBranch,
    AdaptationOutlineRelease,
    list[EpisodeAdaptationOutline],
    GenerationJob,
    GenerationJob,
]:
    branch, outline_release, outline_episodes = current_adaptation_outline_context(db, project)
    accepted_jobs: list[GenerationJob] = []
    for stage_key, label in (("characters", "角色"), ("art", "美术")):
        stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project.id,
                StageState.stage_key == stage_key,
            )
        )
        job_id = (
            (stage.decision or {}).get("candidate_job_id")
            if stage and stage.status == "accepted"
            else None
        )
        job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == job_id,
                GenerationJob.project_id == project.id,
                GenerationJob.stage_key == stage_key,
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(select(GenerationOutput.id).where(GenerationOutput.job_id == job_id))
            if job
            else None
        )
        if not job or not output:
            raise EpisodeSourceMappingError(
                f"{label}阶段需要重新生成并验收一次，确保当前版本可追溯。"
            )
        scope = job.input_snapshot.get("scope") or {}
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline_release.id
            or outline_release.id not in job.input_snapshot.get("input_refs", [])
        ):
            raise EpisodeSourceMappingError(
                f"{label}阶段验收版本不属于当前改编大纲，请重新生成并验收。"
            )
        accepted_jobs.append(job)
    art_scope = accepted_jobs[1].input_snapshot.get("scope") or {}
    if art_scope.get("character_job_id") != accepted_jobs[0].id or accepted_jobs[
        0
    ].id not in accepted_jobs[1].input_snapshot.get("input_refs", []):
        raise EpisodeSourceMappingError("美术设定没有引用当前已验收的视频角色约束版本。")
    return branch, outline_release, outline_episodes, accepted_jobs[0], accepted_jobs[1]


def current_adaptation_script_release_context(
    db: Session, project: Project
) -> tuple[
    AdaptationBranch,
    AdaptationOutlineRelease,
    list[EpisodeAdaptationOutline],
    ScriptRelease,
    GenerationJob,
    GenerationJob,
]:
    branch, outline_release, outline_episodes, character_job, art_job = (
        current_adaptation_script_context(db, project)
    )
    script_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "script",
        )
    )
    script_release_id = (
        (script_stage.decision or {}).get("script_release_id")
        if script_stage and script_stage.status == "accepted"
        else None
    )
    script_release = db.scalar(
        select(ScriptRelease).where(
            ScriptRelease.id == script_release_id,
            ScriptRelease.branch_id == branch.id,
            ScriptRelease.outline_release_id == outline_release.id,
        )
    )
    if not script_release:
        raise EpisodeSourceMappingError("当前分支尚无已验收的分集剧本版本。")
    if (
        script_release.character_job_id != character_job.id
        or script_release.art_job_id != art_job.id
        or script_release.episode_count != len(outline_episodes)
    ):
        raise EpisodeSourceMappingError("剧本引用的大纲、角色或美术版本已变化。")
    return branch, outline_release, outline_episodes, script_release, character_job, art_job


def current_adaptation_outline_context(
    db: Session, project: Project
) -> tuple[AdaptationBranch, AdaptationOutlineRelease, list[EpisodeAdaptationOutline]]:
    branch, _ = current_adaptation_branch(db, project)
    outline_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "outline",
        )
    )
    outline_release_id = (
        (outline_stage.decision or {}).get("outline_release_id")
        if outline_stage and outline_stage.status == "accepted"
        else None
    )
    outline_release = db.scalar(
        select(AdaptationOutlineRelease).where(
            AdaptationOutlineRelease.id == outline_release_id,
            AdaptationOutlineRelease.branch_id == branch.id,
        )
    )
    if not outline_release:
        raise EpisodeSourceMappingError("当前改编分支尚无已验收的视频改编大纲。")
    outline_episodes = db.scalars(
        select(EpisodeAdaptationOutline)
        .where(EpisodeAdaptationOutline.outline_release_id == outline_release.id)
        .order_by(EpisodeAdaptationOutline.episode_number)
    ).all()
    if len(outline_episodes) != outline_release.episode_count:
        raise EpisodeSourceMappingError("当前已验收大纲的逐集场景记录不完整。")
    return branch, outline_release, outline_episodes


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


def parse_script_candidate(
    content: str,
    *,
    branch_id: str,
    release_id: str,
    outline_release_id: str,
    character_job_id: str,
    art_job_id: str,
    outline_episodes: list[dict],
    chapter_bodies: dict[int, str],
) -> ScriptCandidate:
    try:
        script = ScriptCandidate.model_validate_json(content)
    except ValidationError as error:
        raise EpisodeSourceMappingError("分集剧本格式无效，请检查候选字段。") from error
    if (
        script.branch_id != branch_id
        or script.release_id != release_id
        or script.outline_release_id != outline_release_id
        or script.character_job_id != character_job_id
        or script.art_job_id != art_job_id
        or script.episode_count != len(outline_episodes)
    ):
        raise EpisodeSourceMappingError("剧本候选引用的分支、大纲或已验收角色/美术版本已变化。")
    if [episode.episode_number for episode in script.episodes] != list(
        range(1, len(outline_episodes) + 1)
    ):
        raise EpisodeSourceMappingError("剧本必须覆盖当前大纲全部集数，且集序连续。")
    for episode, outline_episode in zip(script.episodes, outline_episodes, strict=True):
        planned_scenes = outline_episode["scenes"]
        if [scene.scene_number for scene in episode.scenes] != list(
            range(1, len(planned_scenes) + 1)
        ):
            raise EpisodeSourceMappingError(
                f"第 {episode.episode_number} 集必须完整沿用已验收大纲的场次结构。"
            )
        for scene, planned_scene in zip(episode.scenes, planned_scenes, strict=True):
            if scene.scene_number != planned_scene["scene_number"]:
                raise EpisodeSourceMappingError("剧本场次序号与已验收大纲不一致。")
            allowed_ordinals = set(planned_scene["source_chapter_ordinals"])
            if not scene.action.strip():
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场缺少动作描述。"
                )
            allocated_seconds = scene.action_seconds
            if scene.action_seconds == 0 and not scene.dialogues:
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场没有分配"
                    "动作或对白时长。"
                )
            if [line.dialogue_number for line in scene.dialogues] != list(
                range(1, len(scene.dialogues) + 1)
            ):
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场对白序号必须连续。"
                )
            for line in scene.dialogues:
                allocated_seconds += line.estimated_seconds
                if line.speaker not in planned_scene["character_names"] and line.speaker not in {
                    "旁白",
                    "解说",
                    "VO",
                }:
                    raise EpisodeSourceMappingError(
                        f"第 {episode.episode_number} 集第 {scene.scene_number} 场对白说话人"
                        "不在已验收场景角色中。"
                    )
                if line.source_chapter_ordinals != sorted(set(line.source_chapter_ordinals)):
                    raise EpisodeSourceMappingError("对白出处章节需去重并按原文顺序排列。")
                if not set(line.source_chapter_ordinals).issubset(allowed_ordinals):
                    raise EpisodeSourceMappingError(
                        f"第 {episode.episode_number} 集第 {scene.scene_number} 场对白引用了"
                        "其他场次的章节。"
                    )
                if not line.source_chapter_ordinals and not planned_scene["is_adaptation_addition"]:
                    raise EpisodeSourceMappingError(
                        f"第 {episode.episode_number} 集第 {scene.scene_number} 场对白缺少"
                        "原文来源或新增场次标记。"
                    )
                if line.origin == "direct_quote":
                    if not line.source_chapter_ordinals or not any(
                        line.text in chapter_bodies.get(ordinal, "")
                        for ordinal in line.source_chapter_ordinals
                    ):
                        raise EpisodeSourceMappingError(
                            f"第 {episode.episode_number} 集含有无法在引用章节中定位的原文直引。"
                        )
            if allocated_seconds > planned_scene["estimated_seconds"]:
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场的对白与动作"
                    "时长超出大纲预算。"
                )
    return script


def parse_storyboard_plan(
    content: str,
    *,
    branch_id: str,
    script_release_id: str,
    character_job_id: str,
    art_job_id: str,
    script_episodes: list[dict],
    outline_episodes: list[dict],
) -> StoryboardPlanCandidate:
    try:
        plan = StoryboardPlanCandidate.model_validate_json(content)
    except ValidationError as error:
        raise EpisodeSourceMappingError("分镜候选格式无效，请检查镜头字段。") from error
    if (
        plan.branch_id != branch_id
        or plan.script_release_id != script_release_id
        or plan.character_job_id != character_job_id
        or plan.art_job_id != art_job_id
        or plan.episode_count != len(script_episodes)
        or len(script_episodes) != len(outline_episodes)
    ):
        raise EpisodeSourceMappingError("分镜候选引用的剧本或角色/美术版本已变化。")
    if [episode.episode_number for episode in plan.episodes] != list(
        range(1, len(script_episodes) + 1)
    ):
        raise EpisodeSourceMappingError("分镜必须完整覆盖剧本集数，集序不得缺失或重复。")
    for episode, script_episode, outline_episode in zip(
        plan.episodes, script_episodes, outline_episodes, strict=True
    ):
        if episode.episode_number != script_episode["episode_number"]:
            raise EpisodeSourceMappingError("分镜集序与已验收剧本不一致。")
        if len(episode.scenes) != len(script_episode["scenes"]):
            raise EpisodeSourceMappingError(
                f"第 {episode.episode_number} 集分镜必须覆盖剧本中的全部场次。"
            )
        if len(episode.scenes) != len(outline_episode["scenes"]):
            raise EpisodeSourceMappingError("分镜场次与已验收大纲结构不一致。")
        for scene, script_scene, outline_scene in zip(
            episode.scenes,
            script_episode["scenes"],
            outline_episode["scenes"],
            strict=True,
        ):
            if (
                scene.scene_number != script_scene["scene_number"]
                or scene.scene_number != outline_scene["scene_number"]
            ):
                raise EpisodeSourceMappingError("分镜场次序号必须沿用剧本和大纲。")
            if not scene.shots:
                raise EpisodeSourceMappingError("每个剧本场次至少需要一个镜头。")
            if [shot.shot_number for shot in scene.shots] != list(range(1, len(scene.shots) + 1)):
                raise EpisodeSourceMappingError("每场镜头序号必须从 1 连续排列。")
            dialogue_numbers = [number for shot in scene.shots for number in shot.dialogue_numbers]
            expected_dialogue_numbers = [
                line["dialogue_number"] for line in script_scene["dialogues"]
            ]
            if len(dialogue_numbers) != len(set(dialogue_numbers)) or set(dialogue_numbers) != set(
                expected_dialogue_numbers
            ):
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场的每句对白"
                    "必须且只能覆盖一次。"
                )
            target_seconds = script_scene["action_seconds"] + sum(
                line["estimated_seconds"] for line in script_scene["dialogues"]
            )
            if sum(shot.duration_seconds for shot in scene.shots) != target_seconds:
                raise EpisodeSourceMappingError(
                    f"第 {episode.episode_number} 集第 {scene.scene_number} 场镜头时长"
                    "必须精确覆盖剧本动作与对白时长。"
                )
            allowed_sources = set(outline_scene["source_chapter_ordinals"])
            allowed_characters = set(outline_scene["character_names"])
            for shot in scene.shots:
                if shot.source_chapter_ordinals != outline_scene["source_chapter_ordinals"]:
                    raise EpisodeSourceMappingError(
                        f"第 {episode.episode_number} 集第 {scene.scene_number} 场镜头出处"
                        "必须继承已验收大纲。"
                    )
                if not set(shot.character_names).issubset(allowed_characters):
                    raise EpisodeSourceMappingError("镜头不能引入当前场景角色名单之外的人物。")
                if shot.dialogue_numbers and not set(shot.dialogue_numbers).issubset(
                    set(expected_dialogue_numbers)
                ):
                    raise EpisodeSourceMappingError("镜头对白编号必须来自当前剧本场次。")
                if shot.source_chapter_ordinals and not set(shot.source_chapter_ordinals).issubset(
                    allowed_sources
                ):
                    raise EpisodeSourceMappingError("镜头引用了超出已验收场景的章节。")
                if not shot.continuity_anchors:
                    raise EpisodeSourceMappingError("每个镜头都必须写明连续性检查锚点。")
    return plan
