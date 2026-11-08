from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    AudioCandidate,
    DeliveryMaster,
    KeyframeCandidate,
    Project,
    StageState,
    VideoCandidate,
)
from ..services.audit import audit
from ..services.keyframe_plan import KeyframePlanError, current_shot_plan_release, required_shots
from ..services.media_decisions import MediaDecisionCandidates


def materialize_media_decision(
    db: Session,
    project: Project,
    project_id: str,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    reason: str | None,
    candidates: MediaDecisionCandidates,
) -> bool:
    keyframe = candidates.keyframe
    if stage_key == "keyframes" and keyframe:
        if action == "accept":
            previous = db.scalars(
                select(KeyframeCandidate).where(
                    KeyframeCandidate.project_id == project_id,
                    KeyframeCandidate.shot_plan_release_id == keyframe.shot_plan_release_id,
                    KeyframeCandidate.episode_number == keyframe.episode_number,
                    KeyframeCandidate.scene_number == keyframe.scene_number,
                    KeyframeCandidate.shot_number == keyframe.shot_number,
                    KeyframeCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        keyframe.status = "accepted" if action == "accept" else "rejected"
        db.flush()
        accepted_rows = db.scalars(
            select(KeyframeCandidate).where(
                KeyframeCandidate.project_id == project_id,
                KeyframeCandidate.shot_plan_release_id == keyframe.shot_plan_release_id,
                KeyframeCandidate.status == "accepted",
            )
        ).all()
        accepted_shots = {
            (item.episode_number, item.scene_number, item.shot_number) for item in accepted_rows
        }
        try:
            release = current_shot_plan_release(db, project)
            all_accepted = accepted_shots == required_shots(release)
        except KeyframePlanError:
            all_accepted = False
        stage.status = "accepted" if all_accepted else "blocked"
        stage.decision = {
            "action": action,
            "candidate_job_id": keyframe.job_id,
            "keyframe_candidate_id": keyframe.id,
            "shot_plan_release_id": keyframe.shot_plan_release_id,
            "episode_number": keyframe.episode_number,
            "scene_number": keyframe.scene_number,
            "shot_number": keyframe.shot_number,
            "reason": reason,
            "accepted_shot_count": len(accepted_shots),
            "required_shot_count": len(required_shots(release)) if all_accepted else None,
        }
        audit(db, project_id, f"keyframe.{keyframe.status}", keyframe.id, stage.decision)
        return True

    video = candidates.video
    if stage_key == "video" and video:
        if action == "accept":
            previous = db.scalars(
                select(VideoCandidate).where(
                    VideoCandidate.project_id == project_id,
                    VideoCandidate.shot_plan_release_id == video.shot_plan_release_id,
                    VideoCandidate.episode_number == video.episode_number,
                    VideoCandidate.scene_number == video.scene_number,
                    VideoCandidate.shot_number == video.shot_number,
                    VideoCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        video.status = "accepted" if action == "accept" else "rejected"
        db.flush()
        accepted_rows = db.scalars(
            select(VideoCandidate).where(
                VideoCandidate.project_id == project_id,
                VideoCandidate.shot_plan_release_id == video.shot_plan_release_id,
                VideoCandidate.status == "accepted",
            )
        ).all()
        accepted_shots = {
            (item.episode_number, item.scene_number, item.shot_number) for item in accepted_rows
        }
        try:
            release = current_shot_plan_release(db, project)
            required = required_shots(release)
            all_accepted = accepted_shots == required
        except KeyframePlanError:
            required = set()
            all_accepted = False
        stage.status = "accepted" if all_accepted else "blocked"
        stage.decision = {
            "action": action,
            "candidate_job_id": video.job_id,
            "video_candidate_id": video.id,
            "shot_plan_release_id": video.shot_plan_release_id,
            "episode_number": video.episode_number,
            "scene_number": video.scene_number,
            "shot_number": video.shot_number,
            "reason": reason,
            "accepted_shot_count": len(accepted_shots),
            "required_shot_count": len(required),
        }
        audit(db, project_id, f"video.{video.status}", video.id, stage.decision)
        return True

    audio = candidates.audio
    voice_script = candidates.voice_script
    if stage_key == "voice" and audio and voice_script:
        if action == "accept":
            previous = db.scalars(
                select(AudioCandidate).where(
                    AudioCandidate.project_id == project_id,
                    AudioCandidate.script_release_id == audio.script_release_id,
                    AudioCandidate.episode_number == audio.episode_number,
                    AudioCandidate.scene_number == audio.scene_number,
                    AudioCandidate.dialogue_number == audio.dialogue_number,
                    AudioCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        audio.status = "accepted" if action == "accept" else "rejected"
        db.flush()
        accepted_lines = db.scalars(
            select(AudioCandidate).where(
                AudioCandidate.project_id == project_id,
                AudioCandidate.script_release_id == audio.script_release_id,
                AudioCandidate.status == "accepted",
            )
        ).all()
        accepted_dialogues = {
            (item.episode_number, item.scene_number, item.dialogue_number)
            for item in accepted_lines
        }
        required_dialogues = {
            (episode["episode_number"], scene["scene_number"], line["dialogue_number"])
            for episode in voice_script.episodes
            for scene in episode["scenes"]
            for line in scene["dialogues"]
        }
        all_accepted = accepted_dialogues == required_dialogues
        stage.status = "accepted" if all_accepted else "blocked"
        stage.decision = {
            "action": action,
            "candidate_job_id": audio.job_id,
            "audio_candidate_id": audio.id,
            "script_release_id": audio.script_release_id,
            "episode_number": audio.episode_number,
            "scene_number": audio.scene_number,
            "dialogue_number": audio.dialogue_number,
            "reason": reason,
            "accepted_dialogue_count": len(accepted_dialogues),
            "required_dialogue_count": len(required_dialogues),
        }
        audit(db, project_id, f"voice.candidate_{audio.status}", audio.id, stage.decision)
        return True

    package = candidates.edit_package
    if stage_key == "post" and package:
        package.status = "accepted" if action == "accept" else "rejected"
        stage.decision = {
            "action": action,
            "edit_package_id": package.id,
            "revision": package.revision,
            "reason": reason,
            "shot_count": package.shot_count,
            "subtitle_count": package.subtitle_count,
            "sha256": package.sha256,
        }
        audit(db, project_id, f"post.edit_package_{package.status}", package.id, stage.decision)
        return True

    master: DeliveryMaster | None = candidates.delivery_master
    if stage_key == "delivery" and master:
        master.status = "accepted" if action == "accept" else "rejected"
        stage.decision = {
            "action": action,
            "delivery_master_id": master.id,
            "revision": master.revision,
            "edit_package_id": master.edit_package_id,
            "reason": reason,
            "size_bytes": master.size_bytes,
            "sha256": master.sha256,
            "duration_seconds": master.duration_seconds,
        }
        audit(db, project_id, f"delivery.master_{master.status}", master.id, stage.decision)
        return True
    return False
