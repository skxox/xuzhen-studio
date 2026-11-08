import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    AdaptationBranch,
    AdaptationOutlineRelease,
    AudioCandidate,
    Chapter,
    CommercialBrief,
    CreativeBrief,
    EpisodeAdaptationOutline,
    EpisodeSourceMapping,
    KeyframeCandidate,
    ManuscriptRelease,
    ScriptRelease,
    ShotPlanRelease,
    StageState,
    VideoCandidate,
)
from ..services.adaptation_decisions import (
    AdaptationDecisionError,
    AdaptationDecisions,
    validate_adaptation_decision,
    validate_asset_decision,
)
from ..services.adaptation_mapping import current_adaptation_branch
from ..services.keyframe_plan import (
    KeyframePlanError,
    current_shot_plan_release,
    required_shots,
)
from ..services.media_decisions import MediaDecisionError, validate_media_decision
from ..services.novel_decisions import NovelDecisionError, validate_novel_decision
from ..services.workflow_policy import StageDecisionPolicyError, validate_stage_decision
from .common import (
    audit,
    get_db,
    project_or_404,
    refresh_ready_stages,
)
from .schemas import (
    GateDecision,
)

router = APIRouter()


@router.post("/projects/{project_id}/stages/{stage_key}/decision")
def decide_stage(
    project_id: str, stage_key: str, data: GateDecision, db: Session = Depends(get_db)
):
    project = project_or_404(db, project_id)
    stage = db.scalar(
        select(StageState)
        .where(StageState.project_id == project_id, StageState.stage_key == stage_key)
        .with_for_update()
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    try:
        target = validate_stage_decision(
            db,
            project,
            stage,
            stage_key,
            action=data.action,
            reason=data.reason,
            risk_ack=data.risk_ack,
        )
    except StageDecisionPolicyError as error:
        raise HTTPException(error.status_code, error.detail) from None
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "adaptation":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "source_rights_must_be_recorded")
    try:
        adaptation_decisions = (
            validate_adaptation_decision(db, project, stage, stage_key)
            if data.action == "accept"
            else AdaptationDecisions()
        )
    except AdaptationDecisionError as error:
        raise HTTPException(error.status_code, error.detail) from None
    mapping_decision = adaptation_decisions.mapping
    outline_decision = adaptation_decisions.outline
    script_decision = adaptation_decisions.script
    shot_plan_decision = adaptation_decisions.shot_plan
    try:
        media_candidates = validate_media_decision(db, project, stage, stage_key)
    except MediaDecisionError as error:
        raise HTTPException(409, error.detail) from None
    keyframe_candidate = media_candidates.keyframe
    video_candidate = media_candidates.video
    audio_candidate = media_candidates.audio
    voice_script = media_candidates.voice_script
    edit_package = media_candidates.edit_package
    delivery_master = media_candidates.delivery_master
    if data.action == "accept":
        try:
            validate_asset_decision(db, project, stage, stage_key)
        except AdaptationDecisionError as error:
            raise HTTPException(error.status_code, error.detail) from None
    try:
        novel_decisions = validate_novel_decision(
            db,
            project,
            stage,
            stage_key,
            action=data.action,
            risk_ack=data.risk_ack,
            reason=data.reason,
        )
    except NovelDecisionError as error:
        raise HTTPException(error.status_code, error.detail) from None
    continuity_decision = novel_decisions.continuity
    continuity_stage = novel_decisions.continuity_stage
    release_decision = novel_decisions.release
    chapter_candidate = novel_decisions.chapter
    candidate_job = novel_decisions.chapter_job
    if chapter_candidate is not None and candidate_job is not None:
        expected_ordinal = chapter_candidate.ordinal
        previous_versions = db.scalars(
            select(Chapter.version).where(
                Chapter.project_id == project_id, Chapter.ordinal == expected_ordinal
            )
        ).all()
        chapter = Chapter(
            project_id=project_id,
            ordinal=chapter_candidate.ordinal,
            title=chapter_candidate.title,
            body=chapter_candidate.body,
            content_hash=hashlib.sha256(chapter_candidate.body.encode("utf-8")).hexdigest(),
            version=max(previous_versions, default=0) + 1,
            source_name=f"ai-job:{candidate_job.id}",
        )
        db.add(chapter)
        db.flush()
        stage.decision = {
            "action": "accept",
            "candidate_job_id": candidate_job.id,
            "chapter_id": chapter.id,
            "chapter_ordinal": chapter.ordinal,
            "chapter_version": chapter.version,
        }
        audit(
            db,
            project_id,
            "chapter.generated_accepted",
            chapter.id,
            {
                "job_id": candidate_job.id,
                "ordinal": chapter.ordinal,
                "version": chapter.version,
                "content_hash": chapter.content_hash,
            },
        )
    stage.status = target
    stage.version += 1
    stage.stale = False
    if stage_key == "continuity" and data.action == "accept" and continuity_decision:
        report = continuity_decision.report
        stage.decision = {
            "action": "accept",
            "candidate_job_id": continuity_decision.job.id,
            "report_revision": continuity_decision.output.revision,
            "chapter_start": report.chapter_start,
            "chapter_end": report.chapter_end,
            "risk_ack": data.risk_ack,
            "reason": data.reason,
        }
        audit(
            db,
            project_id,
            "continuity.report_accepted",
            stage.id,
            {
                "candidate_job_id": continuity_decision.job.id,
                "chapter_start": report.chapter_start,
                "chapter_end": report.chapter_end,
                "finding_count": len(report.findings),
            },
        )
    elif stage_key == "manuscriptRelease" and data.action == "accept" and release_decision:
        previous_release = db.scalar(
            select(ManuscriptRelease)
            .where(ManuscriptRelease.project_id == project_id)
            .order_by(ManuscriptRelease.revision.desc())
            .limit(1)
        )
        release = ManuscriptRelease(
            project_id=project_id,
            revision=(previous_release.revision + 1) if previous_release else 1,
            chapter_start=release_decision["chapter_start"],
            chapter_end=release_decision["chapter_end"],
            chapter_versions=release_decision["chapter_versions"],
            continuity_job_id=release_decision["continuity_job_id"],
            continuity_revision=release_decision["continuity_report_revision"],
            rights_status=project.rights_status,
            risk_ack=release_decision["continuity_risk_ack"],
            decision_reason=(continuity_stage.decision or {}).get("reason"),
            previous_release_id=previous_release.id if previous_release else None,
        )
        db.add(release)
        db.flush()
        release_decision["release_id"] = release.id
        release_decision["revision"] = release.revision
        release_decision["previous_release_id"] = release.previous_release_id
        stage.decision = release_decision
        audit(db, project_id, "manuscript.release_locked", release.id, release_decision)
    elif stage_key == "source" and data.action == "accept" and mapping_decision:
        previous_branch = db.scalar(
            select(AdaptationBranch)
            .where(AdaptationBranch.project_id == project_id)
            .order_by(AdaptationBranch.revision.desc())
            .limit(1)
        )
        branch = AdaptationBranch(
            project_id=project_id,
            release_id=mapping_decision["release_id"],
            revision=(previous_branch.revision + 1) if previous_branch else 1,
            episode_count=mapping_decision["episode_count"],
            episode_seconds=mapping_decision["episode_seconds"],
            aspect_ratio=mapping_decision["aspect_ratio"],
            previous_branch_id=previous_branch.id if previous_branch else None,
        )
        db.add(branch)
        db.flush()
        for episode in mapping_decision["episodes"]:
            db.add(
                EpisodeSourceMapping(
                    branch_id=branch.id,
                    episode_number=episode.episode_number,
                    chapter_ordinals=episode.chapter_ordinals,
                    target=episode.target,
                    conflict=episode.conflict,
                    turn=episode.turn,
                    ending_hook=episode.ending_hook,
                    preserve_facts=episode.preserve_facts,
                    allowed_changes=episode.allowed_changes,
                    adaptation_note=episode.adaptation_note,
                )
            )
        stage.decision = {
            "action": "accept",
            "candidate_job_id": mapping_decision["candidate_job_id"],
            "branch_id": branch.id,
            "branch_revision": branch.revision,
            "release_id": branch.release_id,
            "episode_count": branch.episode_count,
            "episode_seconds": branch.episode_seconds,
            "aspect_ratio": branch.aspect_ratio,
        }
        audit(
            db,
            project_id,
            "adaptation.branch_created",
            branch.id,
            {**stage.decision, "mapping_count": len(mapping_decision["episodes"])},
        )
    elif stage_key == "outline" and data.action == "accept" and outline_decision:
        branch, _ = current_adaptation_branch(db, project)
        previous_release = db.scalar(
            select(AdaptationOutlineRelease)
            .where(AdaptationOutlineRelease.branch_id == branch.id)
            .order_by(AdaptationOutlineRelease.revision.desc())
            .limit(1)
        )
        outline = outline_decision["outline"]
        outline_release = AdaptationOutlineRelease(
            branch_id=branch.id,
            revision=(previous_release.revision + 1) if previous_release else 1,
            job_id=outline_decision["candidate_job_id"],
            episode_count=outline.episode_count,
            creative_thesis=outline.creative_thesis,
        )
        db.add(outline_release)
        db.flush()
        for episode in outline.episodes:
            db.add(
                EpisodeAdaptationOutline(
                    outline_release_id=outline_release.id,
                    episode_number=episode.episode_number,
                    source_chapter_ordinals=episode.source_chapter_ordinals,
                    adaptation_summary=episode.adaptation_summary,
                    emotional_arc=episode.emotional_arc,
                    ending_hook=episode.ending_hook,
                    scenes=[scene.model_dump() for scene in episode.scenes],
                )
            )
        stage.decision = {
            "action": "accept",
            "candidate_job_id": outline_decision["candidate_job_id"],
            "branch_id": branch.id,
            "outline_release_id": outline_release.id,
            "outline_revision": outline_release.revision,
            "episode_count": outline_release.episode_count,
        }
        audit(
            db,
            project_id,
            "adaptation.outline_accepted",
            outline_release.id,
            stage.decision,
        )
    elif stage_key == "script" and data.action == "accept" and script_decision:
        previous_release = db.scalar(
            select(ScriptRelease)
            .where(ScriptRelease.branch_id == script_decision["branch_id"])
            .order_by(ScriptRelease.revision.desc())
            .limit(1)
        )
        release = ScriptRelease(
            branch_id=script_decision["branch_id"],
            outline_release_id=script_decision["outline_release_id"],
            revision=(previous_release.revision + 1) if previous_release else 1,
            job_id=script_decision["candidate_job_id"],
            character_job_id=script_decision["character_job_id"],
            art_job_id=script_decision["art_job_id"],
            episode_count=len(script_decision["episodes"]),
            episodes=[episode.model_dump() for episode in script_decision["episodes"]],
        )
        db.add(release)
        db.flush()
        stage.decision = {
            "action": "accept",
            "candidate_job_id": release.job_id,
            "script_release_id": release.id,
            "script_revision": release.revision,
            "branch_id": release.branch_id,
            "outline_release_id": release.outline_release_id,
            "episode_count": release.episode_count,
            "character_job_id": release.character_job_id,
            "art_job_id": release.art_job_id,
        }
        audit(db, project_id, "script.release_accepted", release.id, stage.decision)
    elif stage_key == "shotDesign" and data.action == "accept" and shot_plan_decision:
        previous = db.scalar(
            select(ShotPlanRelease)
            .where(ShotPlanRelease.branch_id == shot_plan_decision["branch_id"])
            .order_by(ShotPlanRelease.revision.desc())
            .limit(1)
        )
        episodes = [episode.model_dump() for episode in shot_plan_decision["episodes"]]
        release = ShotPlanRelease(
            branch_id=shot_plan_decision["branch_id"],
            script_release_id=shot_plan_decision["script_release_id"],
            revision=(previous.revision + 1) if previous else 1,
            job_id=shot_plan_decision["candidate_job_id"],
            character_job_id=shot_plan_decision["character_job_id"],
            art_job_id=shot_plan_decision["art_job_id"],
            episode_count=len(episodes),
            shot_count=sum(len(scene["shots"]) for ep in episodes for scene in ep["scenes"]),
            episodes=episodes,
        )
        db.add(release)
        db.flush()
        stage.decision = {
            "action": "accept",
            "candidate_job_id": release.job_id,
            "shot_plan_release_id": release.id,
            "revision": release.revision,
            "branch_id": release.branch_id,
            "script_release_id": release.script_release_id,
            "episode_count": release.episode_count,
            "shot_count": release.shot_count,
        }
        audit(db, project_id, "storyboard.release_accepted", release.id, stage.decision)
    elif stage_key == "keyframes" and keyframe_candidate:
        if data.action == "accept":
            previous = db.scalars(
                select(KeyframeCandidate).where(
                    KeyframeCandidate.project_id == project_id,
                    KeyframeCandidate.shot_plan_release_id
                    == keyframe_candidate.shot_plan_release_id,
                    KeyframeCandidate.episode_number == keyframe_candidate.episode_number,
                    KeyframeCandidate.scene_number == keyframe_candidate.scene_number,
                    KeyframeCandidate.shot_number == keyframe_candidate.shot_number,
                    KeyframeCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        keyframe_candidate.status = "accepted" if data.action == "accept" else "rejected"
        db.flush()
        accepted_rows = db.scalars(
            select(KeyframeCandidate).where(
                KeyframeCandidate.project_id == project_id,
                KeyframeCandidate.shot_plan_release_id == keyframe_candidate.shot_plan_release_id,
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
            "action": data.action,
            "candidate_job_id": keyframe_candidate.job_id,
            "keyframe_candidate_id": keyframe_candidate.id,
            "shot_plan_release_id": keyframe_candidate.shot_plan_release_id,
            "episode_number": keyframe_candidate.episode_number,
            "scene_number": keyframe_candidate.scene_number,
            "shot_number": keyframe_candidate.shot_number,
            "reason": data.reason,
            "accepted_shot_count": len(accepted_shots),
            "required_shot_count": len(required_shots(release)) if all_accepted else None,
        }
        audit(
            db,
            project_id,
            f"keyframe.{keyframe_candidate.status}",
            keyframe_candidate.id,
            stage.decision,
        )
    elif stage_key == "video" and video_candidate:
        if data.action == "accept":
            previous = db.scalars(
                select(VideoCandidate).where(
                    VideoCandidate.project_id == project_id,
                    VideoCandidate.shot_plan_release_id == video_candidate.shot_plan_release_id,
                    VideoCandidate.episode_number == video_candidate.episode_number,
                    VideoCandidate.scene_number == video_candidate.scene_number,
                    VideoCandidate.shot_number == video_candidate.shot_number,
                    VideoCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        video_candidate.status = "accepted" if data.action == "accept" else "rejected"
        db.flush()
        accepted_rows = db.scalars(
            select(VideoCandidate).where(
                VideoCandidate.project_id == project_id,
                VideoCandidate.shot_plan_release_id == video_candidate.shot_plan_release_id,
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
            "action": data.action,
            "candidate_job_id": video_candidate.job_id,
            "video_candidate_id": video_candidate.id,
            "shot_plan_release_id": video_candidate.shot_plan_release_id,
            "episode_number": video_candidate.episode_number,
            "scene_number": video_candidate.scene_number,
            "shot_number": video_candidate.shot_number,
            "reason": data.reason,
            "accepted_shot_count": len(accepted_shots),
            "required_shot_count": len(required),
        }
        audit(db, project_id, f"video.{video_candidate.status}", video_candidate.id, stage.decision)
    elif stage_key == "voice" and audio_candidate and voice_script:
        if data.action == "accept":
            previous = db.scalars(
                select(AudioCandidate).where(
                    AudioCandidate.project_id == project_id,
                    AudioCandidate.script_release_id == audio_candidate.script_release_id,
                    AudioCandidate.episode_number == audio_candidate.episode_number,
                    AudioCandidate.scene_number == audio_candidate.scene_number,
                    AudioCandidate.dialogue_number == audio_candidate.dialogue_number,
                    AudioCandidate.status == "accepted",
                )
            ).all()
            for item in previous:
                item.status = "superseded"
        audio_candidate.status = "accepted" if data.action == "accept" else "rejected"
        db.flush()
        accepted_lines = db.scalars(
            select(AudioCandidate).where(
                AudioCandidate.project_id == project_id,
                AudioCandidate.script_release_id == audio_candidate.script_release_id,
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
            "action": data.action,
            "candidate_job_id": audio_candidate.job_id,
            "audio_candidate_id": audio_candidate.id,
            "script_release_id": audio_candidate.script_release_id,
            "episode_number": audio_candidate.episode_number,
            "scene_number": audio_candidate.scene_number,
            "dialogue_number": audio_candidate.dialogue_number,
            "reason": data.reason,
            "accepted_dialogue_count": len(accepted_dialogues),
            "required_dialogue_count": len(required_dialogues),
        }
        audit(
            db,
            project_id,
            f"voice.candidate_{audio_candidate.status}",
            audio_candidate.id,
            stage.decision,
        )
    elif stage_key == "post" and edit_package:
        edit_package.status = "accepted" if data.action == "accept" else "rejected"
        stage.decision = {
            "action": data.action,
            "edit_package_id": edit_package.id,
            "revision": edit_package.revision,
            "reason": data.reason,
            "shot_count": edit_package.shot_count,
            "subtitle_count": edit_package.subtitle_count,
            "sha256": edit_package.sha256,
        }
        audit(
            db,
            project_id,
            f"post.edit_package_{edit_package.status}",
            edit_package.id,
            stage.decision,
        )
    elif stage_key == "delivery" and delivery_master:
        delivery_master.status = "accepted" if data.action == "accept" else "rejected"
        stage.decision = {
            "action": data.action,
            "delivery_master_id": delivery_master.id,
            "revision": delivery_master.revision,
            "edit_package_id": delivery_master.edit_package_id,
            "reason": data.reason,
            "size_bytes": delivery_master.size_bytes,
            "sha256": delivery_master.sha256,
            "duration_seconds": delivery_master.duration_seconds,
        }
        audit(
            db,
            project_id,
            f"delivery.master_{delivery_master.status}",
            delivery_master.id,
            stage.decision,
        )
    elif (
        stage_key not in {"novelDraft", "continuity", "manuscriptRelease"}
        or data.action != "accept"
    ):
        previous_candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        stage.decision = {
            "action": data.action,
            "reason": data.reason,
            "risk_ack": data.risk_ack,
            **(
                {"candidate_job_id": previous_candidate_job_id}
                if data.action == "accept" and previous_candidate_job_id
                else {}
            ),
        }
    if stage_key == "creativeBrief":
        brief = db.scalar(select(CreativeBrief).where(CreativeBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    if stage_key == "commercialBrief":
        brief = db.scalar(select(CommercialBrief).where(CommercialBrief.project_id == project_id))
        if brief:
            brief.status = "accepted" if data.action == "accept" else "draft"
    if data.action in {"accept", "waive"}:
        refresh_ready_stages(db, project)
    audit(db, project_id, "stage.decision", stage.id, stage.decision)
    db.commit()
    return {
        "id": stage.id,
        "stage_key": stage_key,
        "status": stage.status,
        "version": stage.version,
        "decision": stage.decision,
    }
