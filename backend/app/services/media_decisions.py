from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AudioCandidate,
    DeliveryMaster,
    EditPackage,
    KeyframeCandidate,
    Project,
    ScriptRelease,
    ShotPlanRelease,
    StageState,
    VideoCandidate,
)
from .keyframe_plan import KeyframePlanError, current_shot_plan_release


class MediaDecisionError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


@dataclass
class MediaDecisionCandidates:
    keyframe: KeyframeCandidate | None = None
    video: VideoCandidate | None = None
    audio: AudioCandidate | None = None
    voice_script: ScriptRelease | None = None
    edit_package: EditPackage | None = None
    delivery_master: DeliveryMaster | None = None


def validate_media_decision(
    db: Session, project: Project, stage: StageState, stage_key: str
) -> MediaDecisionCandidates:
    if project.creation_mode != "original":
        return MediaDecisionCandidates()
    if stage_key == "keyframes":
        return MediaDecisionCandidates(keyframe=_validate_keyframe(db, project, stage))
    if stage_key == "video":
        return MediaDecisionCandidates(video=_validate_video(db, project, stage))
    if stage_key == "voice":
        audio, script = _validate_voice(db, project, stage)
        return MediaDecisionCandidates(audio=audio, voice_script=script)
    if stage_key == "post":
        return MediaDecisionCandidates(edit_package=_validate_edit_package(db, project, stage))
    if stage_key == "delivery":
        return MediaDecisionCandidates(
            delivery_master=_validate_delivery_master(db, project, stage)
        )
    return MediaDecisionCandidates()


def _current_release(db: Session, project: Project) -> ShotPlanRelease:
    try:
        return current_shot_plan_release(db, project)
    except KeyframePlanError as error:
        raise MediaDecisionError(str(error)) from None


def _validate_keyframe(db: Session, project: Project, stage: StageState) -> KeyframeCandidate:
    job_id = (stage.decision or {}).get("candidate_job_id")
    candidate = db.scalar(
        select(KeyframeCandidate).where(
            KeyframeCandidate.project_id == project.id,
            KeyframeCandidate.job_id == job_id,
            KeyframeCandidate.status == "needs_review",
        )
    )
    if not candidate:
        raise MediaDecisionError("keyframe_candidate_missing")
    release = _current_release(db, project)
    if candidate.shot_plan_release_id != release.id:
        raise MediaDecisionError("keyframe_candidate_shot_plan_stale")
    return candidate


def _validate_video(db: Session, project: Project, stage: StageState) -> VideoCandidate:
    job_id = (stage.decision or {}).get("candidate_job_id")
    candidate = db.scalar(
        select(VideoCandidate).where(
            VideoCandidate.project_id == project.id,
            VideoCandidate.job_id == job_id,
            VideoCandidate.status == "needs_review",
        )
    )
    if not candidate:
        raise MediaDecisionError("video_candidate_missing_or_not_ready")
    release = _current_release(db, project)
    accepted_keyframe = db.scalar(
        select(KeyframeCandidate.id).where(
            KeyframeCandidate.id == candidate.keyframe_candidate_id,
            KeyframeCandidate.status == "accepted",
            KeyframeCandidate.shot_plan_release_id == release.id,
        )
    )
    if candidate.shot_plan_release_id != release.id or not accepted_keyframe:
        raise MediaDecisionError("video_candidate_upstream_keyframe_is_stale")
    return candidate


def _validate_voice(
    db: Session, project: Project, stage: StageState
) -> tuple[AudioCandidate, ScriptRelease]:
    job_id = (stage.decision or {}).get("candidate_job_id")
    candidate = db.scalar(
        select(AudioCandidate).where(
            AudioCandidate.project_id == project.id,
            AudioCandidate.job_id == job_id,
            AudioCandidate.status == "needs_review",
        )
    )
    if not candidate:
        raise MediaDecisionError("audio_candidate_missing_or_not_ready")
    script_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "script",
        )
    )
    current_script_id = (
        (script_stage.decision or {}).get("script_release_id")
        if script_stage and script_stage.status == "accepted"
        else None
    )
    script = db.get(ScriptRelease, current_script_id) if current_script_id else None
    if not script or candidate.script_release_id != script.id:
        raise MediaDecisionError("audio_candidate_script_snapshot_stale")
    return candidate, script


def _validate_edit_package(db: Session, project: Project, stage: StageState) -> EditPackage:
    package_id = (stage.decision or {}).get("edit_package_id")
    package = db.scalar(
        select(EditPackage).where(
            EditPackage.id == package_id,
            EditPackage.project_id == project.id,
            EditPackage.status == "needs_review",
        )
    )
    if not package:
        raise MediaDecisionError("edit_package_candidate_missing")
    release = _current_release(db, project)
    if (
        package.shot_plan_release_id != release.id
        or package.script_release_id != release.script_release_id
    ):
        raise MediaDecisionError("edit_package_source_releases_are_stale")
    return package


def _validate_delivery_master(db: Session, project: Project, stage: StageState) -> DeliveryMaster:
    master_id = (stage.decision or {}).get("delivery_master_id")
    master = db.scalar(
        select(DeliveryMaster).where(
            DeliveryMaster.id == master_id,
            DeliveryMaster.project_id == project.id,
            DeliveryMaster.status == "needs_review",
        )
    )
    if not master:
        raise MediaDecisionError("delivery_master_candidate_missing")
    quality = (master.source_snapshot or {}).get("quality_report")
    if not isinstance(quality, dict) or quality.get("passed") is not True:
        raise MediaDecisionError("delivery_master_quality_check_required")
    for key, code in (
        ("dialogue_audio_fit", "delivery_master_dialogue_fit_check_required"),
        ("video_timing_fit", "delivery_master_video_timing_check_required"),
    ):
        fit = quality.get(key)
        if not isinstance(fit, dict) or fit.get("passed") is not True:
            raise MediaDecisionError(code)
    master_path = (settings.storage_dir / master.storage_key).resolve()
    if settings.storage_dir.resolve() not in master_path.parents or not master_path.is_file():
        raise MediaDecisionError("delivery_master_file_missing")
    post_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project.id,
            StageState.stage_key == "post",
        )
    )
    if (
        not post_stage
        or post_stage.status != "accepted"
        or master.edit_package_id != (post_stage.decision or {}).get("edit_package_id")
    ):
        raise MediaDecisionError("delivery_master_source_package_is_stale")
    return master
