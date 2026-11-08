from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import GenerationJob, GenerationOutput, Project, StageState
from .adaptation_mapping import (
    EpisodeSourceMappingError,
    current_adaptation_branch,
    current_adaptation_outline_context,
    current_adaptation_script_context,
    current_adaptation_script_release_context,
    current_release_chapters,
    parse_adaptation_outline,
    parse_episode_source_mapping,
    parse_script_candidate,
    parse_storyboard_plan,
)

DecisionData = dict[str, object]


class AdaptationDecisionError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


@dataclass
class AdaptationDecisions:
    mapping: DecisionData | None = None
    outline: DecisionData | None = None
    script: DecisionData | None = None
    shot_plan: DecisionData | None = None


def validate_adaptation_decision(
    db: Session, project: Project, stage: StageState, stage_key: str
) -> AdaptationDecisions:
    if project.creation_mode != "original":
        return AdaptationDecisions()
    if stage_key == "source":
        return AdaptationDecisions(mapping=_validate_mapping(db, project, stage))
    if stage_key == "outline":
        return AdaptationDecisions(outline=_validate_outline(db, project, stage))
    if stage_key == "script":
        return AdaptationDecisions(script=_validate_script(db, project, stage))
    if stage_key == "shotDesign":
        return AdaptationDecisions(shot_plan=_validate_shot_plan(db, project, stage))
    return AdaptationDecisions()


def validate_asset_decision(
    db: Session, project: Project, stage: StageState, stage_key: str
) -> None:
    if project.creation_mode != "original" or stage_key not in {"characters", "art"}:
        return
    job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project.id,
            GenerationJob.stage_key == stage_key,
            GenerationJob.status == "succeeded",
        )
    )
    output_id = (
        db.scalar(
            select(GenerationOutput.id).where(
                GenerationOutput.project_id == project.id,
                GenerationOutput.job_id == job_id,
            )
        )
        if job
        else None
    )
    if not job or not output_id:
        raise AdaptationDecisionError(409, "adaptation_asset_candidate_missing")
    try:
        branch, outline_release, _ = current_adaptation_outline_context(db, project)
    except EpisodeSourceMappingError as error:
        raise AdaptationDecisionError(409, str(error)) from None
    scope = job.input_snapshot.get("scope") or {}
    refs = set(job.input_snapshot.get("input_refs", []))
    if (
        scope.get("branch_id") != branch.id
        or scope.get("outline_release_id") != outline_release.id
        or not {branch.id, outline_release.id, outline_release.job_id}.issubset(refs)
    ):
        raise AdaptationDecisionError(409, "adaptation_asset_candidate_scope_changed")
    if stage_key == "art":
        character_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project.id,
                StageState.stage_key == "characters",
            )
        )
        character_job_id = (
            (character_stage.decision or {}).get("candidate_job_id")
            if character_stage and character_stage.status == "accepted"
            else None
        )
        if (
            not character_job_id
            or scope.get("character_job_id") != character_job_id
            or character_job_id not in refs
        ):
            raise AdaptationDecisionError(409, "accepted_video_character_constraints_required")


def _candidate_output(
    db: Session, project: Project, stage: StageState
) -> tuple[GenerationJob, GenerationOutput]:
    job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id,
            GenerationJob.project_id == project.id,
            GenerationJob.stage_key == stage.stage_key,
            GenerationJob.status == "succeeded",
        )
    )
    output = (
        db.scalar(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project.id,
                GenerationOutput.job_id == job_id,
            )
        )
        if job
        else None
    )
    if not job or not output:
        raise AdaptationDecisionError(409, _MISSING_CANDIDATE[stage.stage_key])
    return job, output


_MISSING_CANDIDATE: dict[str, str] = {
    "source": "episode_source_mapping_candidate_missing",
    "outline": "adaptation_outline_candidate_missing",
    "script": "episode_script_candidate_missing",
    "shotDesign": "storyboard_candidate_missing",
}


def _validate_mapping(db: Session, project: Project, stage: StageState) -> DecisionData:
    if project.rights_status == "unconfirmed":
        raise AdaptationDecisionError(422, "original_work_rights_must_be_recorded")
    job, output = _candidate_output(db, project, stage)
    scope = job.input_snapshot.get("scope") or {}
    try:
        release, chapters = current_release_chapters(db, project, str(scope.get("release_id", "")))
        mapping = parse_episode_source_mapping(
            output.content,
            expected_release_id=release.id,
            expected_episode_count=scope["episode_count"],
            expected_episode_seconds=scope["episode_seconds"],
            expected_aspect_ratio=scope["aspect_ratio"],
            allowed_chapter_ordinals={chapter.ordinal for chapter in chapters},
        )
    except (EpisodeSourceMappingError, KeyError) as error:
        raise AdaptationDecisionError(422, str(error)) from None
    return {
        "candidate_job_id": job.id,
        "release_id": release.id,
        "episode_count": mapping.episode_count,
        "episode_seconds": mapping.episode_seconds,
        "aspect_ratio": mapping.aspect_ratio,
        "episodes": mapping.episodes,
    }


def _validate_outline(db: Session, project: Project, stage: StageState) -> DecisionData:
    job, output = _candidate_output(db, project, stage)
    try:
        branch, mappings = current_adaptation_branch(db, project)
        scope = job.input_snapshot.get("scope") or {}
        if scope.get("branch_id") != branch.id:
            raise EpisodeSourceMappingError("候选对应的改编分支已变化。")
        outline = parse_adaptation_outline(
            output.content,
            branch_id=branch.id,
            release_id=branch.release_id,
            episode_seconds=branch.episode_seconds,
            aspect_ratio=branch.aspect_ratio,
            mappings=[{"chapter_ordinals": item.chapter_ordinals} for item in mappings],
        )
    except EpisodeSourceMappingError as error:
        raise AdaptationDecisionError(422, str(error)) from None
    return {"candidate_job_id": job.id, "outline": outline}


def _validate_script(db: Session, project: Project, stage: StageState) -> DecisionData:
    job, output = _candidate_output(db, project, stage)
    try:
        branch, outline_release, episodes, character_job, art_job = (
            current_adaptation_script_context(db, project)
        )
        _, chapters = current_release_chapters(db, project, branch.release_id)
        scope = job.input_snapshot.get("scope") or {}
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline_release.id
            or scope.get("character_job_id") != character_job.id
            or scope.get("art_job_id") != art_job.id
        ):
            raise EpisodeSourceMappingError("剧本候选引用的上游版本已变化。")
        script = parse_script_candidate(
            output.content,
            branch_id=branch.id,
            release_id=branch.release_id,
            outline_release_id=outline_release.id,
            character_job_id=character_job.id,
            art_job_id=art_job.id,
            outline_episodes=[{"scenes": episode.scenes} for episode in episodes],
            chapter_bodies={chapter.ordinal: chapter.body for chapter in chapters},
        )
    except EpisodeSourceMappingError as error:
        raise AdaptationDecisionError(422, str(error)) from None
    return {
        "candidate_job_id": job.id,
        "branch_id": branch.id,
        "outline_release_id": outline_release.id,
        "character_job_id": character_job.id,
        "art_job_id": art_job.id,
        "episodes": script.episodes,
    }


def _validate_shot_plan(db: Session, project: Project, stage: StageState) -> DecisionData:
    job, output = _candidate_output(db, project, stage)
    try:
        branch, outline_release, outline_episodes, script_release, character_job, art_job = (
            current_adaptation_script_release_context(db, project)
        )
        scope = job.input_snapshot.get("scope") or {}
        if scope.get("script_release_id") != script_release.id:
            raise EpisodeSourceMappingError("分镜候选对应的剧本版本已变化。")
        plan = parse_storyboard_plan(
            output.content,
            branch_id=branch.id,
            script_release_id=script_release.id,
            character_job_id=character_job.id,
            art_job_id=art_job.id,
            script_episodes=script_release.episodes,
            outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
        )
    except EpisodeSourceMappingError as error:
        raise AdaptationDecisionError(422, str(error)) from None
    return {
        "candidate_job_id": job.id,
        "branch_id": branch.id,
        "script_release_id": script_release.id,
        "character_job_id": character_job.id,
        "art_job_id": art_job.id,
        "episodes": plan.episodes,
    }
