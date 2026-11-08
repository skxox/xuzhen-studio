import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AdaptationBranch,
    AdaptationOutlineRelease,
    AudioCandidate,
    Chapter,
    CommercialBrief,
    CreativeBrief,
    DeliveryMaster,
    EditPackage,
    EpisodeAdaptationOutline,
    EpisodeSourceMapping,
    GenerationJob,
    GenerationOutput,
    KeyframeCandidate,
    ManuscriptRelease,
    ScriptRelease,
    ShotPlanRelease,
    StageState,
    VideoCandidate,
)
from ..services.adaptation_mapping import (
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
from ..services.continuity import (
    ContinuityReportError,
    parse_continuity_report,
    unresolved_high_findings,
    unresolved_medium_findings,
)
from ..services.keyframe_plan import (
    KeyframePlanError,
    current_shot_plan_release,
    required_shots,
)
from ..services.novel_draft import NovelDraftCandidateError, parse_chapter_candidate
from .common import (
    ALLOWED,
    audit,
    get_db,
    project_or_404,
    refresh_ready_stages,
    stage_dependencies,
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
    if stage.status != "needs_review":
        raise HTTPException(409, "stage_must_be_in_needs_review_before_decision")
    if stage_key == "creativeBrief" and data.action == "waive":
        raise HTTPException(422, "creative_brief_cannot_be_waived")
    if stage_key == "commercialBrief" and data.action == "waive":
        raise HTTPException(422, "commercial_brief_cannot_be_waived")
    if (
        stage_key
        in {"source", "outline", "shotDesign", "keyframes", "video", "voice", "post", "delivery"}
        and data.action == "waive"
    ):
        raise HTTPException(422, "media_production_gates_cannot_be_waived")
    if stage_key in {"continuity", "manuscriptRelease"} and data.action == "waive":
        raise HTTPException(422, "novel_quality_gates_cannot_be_waived")
    if data.action in {"waive", "reject"} and not data.reason:
        raise HTTPException(422, "reason_required")
    if data.action == "waive" and not data.risk_ack:
        raise HTTPException(422, "risk_ack_required")
    targets = {"accept": "accepted", "waive": "waived", "reject": "blocked"}
    target = targets[data.action]
    if target not in ALLOWED.get(stage.status, set()):
        raise HTTPException(409, f"invalid_transition:{stage.status}->{target}")
    if data.action in {"accept", "waive"}:
        deps = stage_dependencies(project, stage_key)
        dep_states = {
            s.stage_key: s.status
            for s in db.scalars(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key.in_(deps)
                )
            ).all()
        }
        missing = [key for key in deps if dep_states.get(key) not in {"accepted", "waived"}]
        if missing:
            raise HTTPException(409, {"code": "upstream_gate_blocked", "stages": missing})
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "adaptation":
        if not db.scalar(select(Chapter.id).where(Chapter.project_id == project_id)):
            raise HTTPException(422, "source_requires_at_least_one_chapter")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "source_rights_must_be_recorded")
    mapping_decision = None
    if stage_key == "source" and data.action == "accept" and project.creation_mode == "original":
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "original_work_rights_must_be_recorded")
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "source",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        scope = (candidate_job.input_snapshot.get("scope") or {}) if candidate_job else {}
        if not candidate_job or not output:
            raise HTTPException(409, "episode_source_mapping_candidate_missing")
        try:
            release, release_chapters = current_release_chapters(
                db, project, str(scope.get("release_id", ""))
            )
            mapping = parse_episode_source_mapping(
                output.content,
                expected_release_id=release.id,
                expected_episode_count=scope["episode_count"],
                expected_episode_seconds=scope["episode_seconds"],
                expected_aspect_ratio=scope["aspect_ratio"],
                allowed_chapter_ordinals={chapter.ordinal for chapter in release_chapters},
            )
        except (EpisodeSourceMappingError, KeyError) as error:
            raise HTTPException(422, str(error)) from None
        mapping_decision = {
            "candidate_job_id": candidate_job.id,
            "release_id": release.id,
            "episode_count": mapping.episode_count,
            "episode_seconds": mapping.episode_seconds,
            "aspect_ratio": mapping.aspect_ratio,
            "episodes": mapping.episodes,
        }
    outline_decision = None
    if stage_key == "outline" and data.action == "accept" and project.creation_mode == "original":
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "outline",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        if not candidate_job or not output:
            raise HTTPException(409, "adaptation_outline_candidate_missing")
        try:
            branch, mappings = current_adaptation_branch(db, project)
            scope = candidate_job.input_snapshot.get("scope") or {}
            if scope.get("branch_id") != branch.id:
                raise EpisodeSourceMappingError("候选对应的改编分支已变化。")
            outline = parse_adaptation_outline(
                output.content,
                branch_id=branch.id,
                release_id=branch.release_id,
                episode_seconds=branch.episode_seconds,
                aspect_ratio=branch.aspect_ratio,
                mappings=[{"chapter_ordinals": mapping.chapter_ordinals} for mapping in mappings],
            )
        except EpisodeSourceMappingError as error:
            raise HTTPException(422, str(error)) from None
        outline_decision = {"candidate_job_id": candidate_job.id, "outline": outline}
    script_decision = None
    if stage_key == "script" and data.action == "accept" and project.creation_mode == "original":
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "script",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        if not candidate_job or not output:
            raise HTTPException(409, "episode_script_candidate_missing")
        try:
            branch, outline_release, outline_episodes, character_job, art_job = (
                current_adaptation_script_context(db, project)
            )
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
            scope = candidate_job.input_snapshot.get("scope") or {}
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
                outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
                chapter_bodies={chapter.ordinal: chapter.body for chapter in release_chapters},
            )
        except EpisodeSourceMappingError as error:
            raise HTTPException(422, str(error)) from None
        script_decision = {
            "candidate_job_id": candidate_job.id,
            "branch_id": branch.id,
            "outline_release_id": outline_release.id,
            "character_job_id": character_job.id,
            "art_job_id": art_job.id,
            "episodes": script.episodes,
        }
    shot_plan_decision = None
    if (
        stage_key == "shotDesign"
        and data.action == "accept"
        and project.creation_mode == "original"
    ):
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "shotDesign",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        if not candidate_job or not output:
            raise HTTPException(409, "storyboard_candidate_missing")
        try:
            branch, outline_release, outline_episodes, script_release, character_job, art_job = (
                current_adaptation_script_release_context(db, project)
            )
            scope = candidate_job.input_snapshot.get("scope") or {}
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
            raise HTTPException(422, str(error)) from None
        shot_plan_decision = {
            "candidate_job_id": candidate_job.id,
            "branch_id": branch.id,
            "script_release_id": script_release.id,
            "character_job_id": character_job.id,
            "art_job_id": art_job.id,
            "episodes": plan.episodes,
        }
    keyframe_candidate = None
    if stage_key == "keyframes" and project.creation_mode == "original":
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        keyframe_candidate = db.scalar(
            select(KeyframeCandidate).where(
                KeyframeCandidate.project_id == project_id,
                KeyframeCandidate.job_id == candidate_job_id,
                KeyframeCandidate.status == "needs_review",
            )
        )
        if not keyframe_candidate:
            raise HTTPException(409, "keyframe_candidate_missing")
        try:
            release = current_shot_plan_release(db, project)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        if keyframe_candidate.shot_plan_release_id != release.id:
            raise HTTPException(409, "keyframe_candidate_shot_plan_stale")
    video_candidate = None
    if stage_key == "video" and project.creation_mode == "original":
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        video_candidate = db.scalar(
            select(VideoCandidate).where(
                VideoCandidate.project_id == project_id,
                VideoCandidate.job_id == candidate_job_id,
                VideoCandidate.status == "needs_review",
            )
        )
        if not video_candidate:
            raise HTTPException(409, "video_candidate_missing_or_not_ready")
        try:
            release = current_shot_plan_release(db, project)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        accepted_keyframe = db.scalar(
            select(KeyframeCandidate.id).where(
                KeyframeCandidate.id == video_candidate.keyframe_candidate_id,
                KeyframeCandidate.status == "accepted",
                KeyframeCandidate.shot_plan_release_id == release.id,
            )
        )
        if video_candidate.shot_plan_release_id != release.id or not accepted_keyframe:
            raise HTTPException(409, "video_candidate_upstream_keyframe_is_stale")
    audio_candidate = None
    voice_script = None
    if stage_key == "voice" and project.creation_mode == "original":
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        audio_candidate = db.scalar(
            select(AudioCandidate).where(
                AudioCandidate.project_id == project_id,
                AudioCandidate.job_id == candidate_job_id,
                AudioCandidate.status == "needs_review",
            )
        )
        if not audio_candidate:
            raise HTTPException(409, "audio_candidate_missing_or_not_ready")
        script_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == "script"
            )
        )
        current_script_id = (
            (script_stage.decision or {}).get("script_release_id")
            if script_stage and script_stage.status == "accepted"
            else None
        )
        voice_script = db.get(ScriptRelease, current_script_id) if current_script_id else None
        if not voice_script or audio_candidate.script_release_id != voice_script.id:
            raise HTTPException(409, "audio_candidate_script_snapshot_stale")
    edit_package = None
    delivery_master = None
    if stage_key == "post" and project.creation_mode == "original":
        package_id = (stage.decision or {}).get("edit_package_id")
        edit_package = db.scalar(
            select(EditPackage).where(
                EditPackage.id == package_id,
                EditPackage.project_id == project_id,
                EditPackage.status == "needs_review",
            )
        )
        if not edit_package:
            raise HTTPException(409, "edit_package_candidate_missing")
        try:
            release = current_shot_plan_release(db, project)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        if (
            edit_package.shot_plan_release_id != release.id
            or edit_package.script_release_id != release.script_release_id
        ):
            raise HTTPException(409, "edit_package_source_releases_are_stale")
    if stage_key == "delivery" and project.creation_mode == "original":
        master_id = (stage.decision or {}).get("delivery_master_id")
        delivery_master = db.scalar(
            select(DeliveryMaster).where(
                DeliveryMaster.id == master_id,
                DeliveryMaster.project_id == project_id,
                DeliveryMaster.status == "needs_review",
            )
        )
        if not delivery_master:
            raise HTTPException(409, "delivery_master_candidate_missing")
        quality_report = (delivery_master.source_snapshot or {}).get("quality_report")
        if not isinstance(quality_report, dict) or quality_report.get("passed") is not True:
            raise HTTPException(409, "delivery_master_quality_check_required")
        dialogue_fit = quality_report.get("dialogue_audio_fit")
        if not isinstance(dialogue_fit, dict) or dialogue_fit.get("passed") is not True:
            raise HTTPException(409, "delivery_master_dialogue_fit_check_required")
        video_fit = quality_report.get("video_timing_fit")
        if not isinstance(video_fit, dict) or video_fit.get("passed") is not True:
            raise HTTPException(409, "delivery_master_video_timing_check_required")
        master_path = (settings.storage_dir / delivery_master.storage_key).resolve()
        if settings.storage_dir.resolve() not in master_path.parents or not master_path.is_file():
            raise HTTPException(409, "delivery_master_file_missing")
        post_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id,
                StageState.stage_key == "post",
            )
        )
        if (
            not post_stage
            or post_stage.status != "accepted"
            or delivery_master.edit_package_id != (post_stage.decision or {}).get("edit_package_id")
        ):
            raise HTTPException(409, "delivery_master_source_package_is_stale")
    if (
        stage_key in {"characters", "art"}
        and data.action == "accept"
        and project.creation_mode == "original"
    ):
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == stage_key,
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput.id).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        if not candidate_job or not output:
            raise HTTPException(409, "adaptation_asset_candidate_missing")
        try:
            branch, outline_release, _ = current_adaptation_outline_context(db, project)
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        scope = candidate_job.input_snapshot.get("scope") or {}
        refs = set(candidate_job.input_snapshot.get("input_refs", []))
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline_release.id
            or not {branch.id, outline_release.id, outline_release.job_id}.issubset(refs)
        ):
            raise HTTPException(409, "adaptation_asset_candidate_scope_changed")
        if stage_key == "art":
            character_stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id,
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
                raise HTTPException(409, "accepted_video_character_constraints_required")
    continuity_decision = None
    release_decision = None
    if stage_key == "continuity" and data.action == "accept":
        continuity_decision = _validated_continuity_decision(db, project_id, stage)
        report = continuity_decision["report"]
        high_open = unresolved_high_findings(report)
        if high_open:
            raise HTTPException(
                422,
                {"code": "high_severity_findings_must_be_resolved", "finding_ids": high_open},
            )
        medium_open = unresolved_medium_findings(report)
        if medium_open and (not data.risk_ack or not data.reason or not data.reason.strip()):
            raise HTTPException(
                422,
                {
                    "code": "open_medium_findings_require_risk_acknowledgement",
                    "finding_ids": medium_open,
                },
            )
        accepted_risk = [
            finding.finding_id for finding in report.findings if finding.status == "accepted_risk"
        ]
        if accepted_risk and (not data.risk_ack or not data.reason or not data.reason.strip()):
            raise HTTPException(422, "accepted_risk_findings_require_reason_and_risk_ack")
    if stage_key == "manuscriptRelease" and data.action == "accept":
        if project.creation_mode != "original":
            raise HTTPException(422, "manuscript_release_requires_original_project")
        if project.rights_status == "unconfirmed":
            raise HTTPException(422, "original_work_rights_must_be_recorded")
        continuity_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == "continuity"
            )
        )
        if not continuity_stage or continuity_stage.status != "accepted":
            raise HTTPException(409, "accepted_continuity_report_required")
        continuity_decision = _validated_continuity_decision(db, project_id, continuity_stage)
        report = continuity_decision["report"]
        if unresolved_high_findings(report):
            raise HTTPException(422, "high_severity_findings_must_be_resolved")
        start, end = report.chapter_start, report.chapter_end
        latest_chapters = _latest_chapters(db, project_id)
        scoped_chapters = [
            latest_chapters[ordinal]
            for ordinal in range(start, end + 1)
            if ordinal in latest_chapters
        ]
        if len(scoped_chapters) != end - start + 1:
            raise HTTPException(409, "manuscript_release_scope_is_not_contiguous")
        if len(scoped_chapters) < 2:
            raise HTTPException(422, "manuscript_release_requires_at_least_two_chapters")
        release_decision = {
            "action": "accept",
            "continuity_job_id": continuity_decision["job"].id,
            "continuity_report_revision": continuity_decision["output"].revision,
            "chapter_start": start,
            "chapter_end": end,
            "continuity_risk_ack": (continuity_stage.decision or {}).get("risk_ack", False),
            "chapter_versions": [
                {
                    "ordinal": item.ordinal,
                    "chapter_id": item.id,
                    "version": item.version,
                    "content_hash": item.content_hash,
                }
                for item in scoped_chapters
            ],
        }
    chapter_candidate = None
    candidate_job = None
    if stage_key == "novelDraft" and data.action == "accept":
        if project.creation_mode != "original":
            raise HTTPException(422, "novel_draft_requires_original_project")
        candidate_job_id = (stage.decision or {}).get("candidate_job_id")
        candidate_job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.id == candidate_job_id,
                GenerationJob.project_id == project_id,
                GenerationJob.stage_key == "novelDraft",
                GenerationJob.status == "succeeded",
            )
        )
        output = (
            db.scalar(
                select(GenerationOutput).where(
                    GenerationOutput.project_id == project_id,
                    GenerationOutput.job_id == candidate_job_id,
                )
            )
            if candidate_job
            else None
        )
        expected_ordinal = (
            (candidate_job.input_snapshot.get("scope") or {}).get("chapter_ordinal")
            if candidate_job
            else None
        )
        if not output or not isinstance(expected_ordinal, int):
            raise HTTPException(409, "novel_chapter_candidate_missing")
        try:
            chapter_candidate = parse_chapter_candidate(output.content, expected_ordinal)
        except NovelDraftCandidateError as error:
            raise HTTPException(422, str(error)) from None
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
        report = continuity_decision["report"]
        stage.decision = {
            "action": "accept",
            "candidate_job_id": continuity_decision["job"].id,
            "report_revision": continuity_decision["output"].revision,
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
                "candidate_job_id": continuity_decision["job"].id,
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


def _latest_chapters(db: Session, project_id: str) -> dict[int, Chapter]:
    items = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.ordinal, Chapter.version.desc())
    ).all()
    latest: dict[int, Chapter] = {}
    for item in items:
        latest.setdefault(item.ordinal, item)
    return latest


def _validated_continuity_decision(db: Session, project_id: str, stage: StageState) -> dict:
    candidate_job_id = (stage.decision or {}).get("candidate_job_id")
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == candidate_job_id,
            GenerationJob.project_id == project_id,
            GenerationJob.stage_key == "continuity",
            GenerationJob.status == "succeeded",
        )
    )
    output = (
        db.scalar(
            select(GenerationOutput).where(
                GenerationOutput.project_id == project_id,
                GenerationOutput.job_id == candidate_job_id,
            )
        )
        if job
        else None
    )
    if not job or not output:
        raise HTTPException(409, "continuity_report_candidate_missing")
    scope = job.input_snapshot.get("scope") or {}
    chapter_start = scope.get("chapter_start")
    chapter_end = scope.get("chapter_end")
    if type(chapter_start) is not int or type(chapter_end) is not int:
        raise HTTPException(409, "continuity_report_scope_missing")
    chapters = _latest_chapters(db, project_id)
    chapter_texts = {
        ordinal: chapters[ordinal].body
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    context_ordinal = scope.get("context_chapter")
    if type(context_ordinal) is int:
        if context_ordinal not in chapters:
            raise HTTPException(409, "continuity_report_context_chapter_changed")
        chapter_texts[context_ordinal] = chapters[context_ordinal].body
    latest_ids = {
        chapters[ordinal].id
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in chapters
    }
    if type(context_ordinal) is int and context_ordinal in chapters:
        latest_ids.add(chapters[context_ordinal].id)
    if not latest_ids.issubset(set(job.input_snapshot.get("input_refs", []))):
        raise HTTPException(409, "continuity_report_chapter_versions_changed")
    try:
        report = parse_continuity_report(
            output.content,
            chapter_start,
            chapter_end,
            chapter_texts,
            allow_review_decisions=True,
        )
    except ContinuityReportError as error:
        raise HTTPException(422, str(error)) from None
    return {"job": job, "output": output, "report": report}
