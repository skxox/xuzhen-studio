import hashlib
import json
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..domain.models import (
    AdaptationBranch,
    AudioCandidate,
    Chapter,
    GenerationJob,
    GenerationOutput,
    GenerationOutputVersion,
    KeyframeCandidate,
    ScriptRelease,
    ServiceProfile,
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
from ..services.continuity import ContinuityReportError, parse_continuity_report
from ..services.keyframe_plan import (
    KeyframePlanError,
    current_shot_plan_release,
    find_shot,
)
from ..services.novel_draft import NovelDraftCandidateError, parse_chapter_candidate
from ..services.openai_compatible import ProviderExecutionError, complete_chat
from ..services.openai_compatible_audio import generate_speech
from ..services.openai_compatible_image import generate_image
from ..services.openai_compatible_video import submit_video
from .common import (
    audit,
    get_db,
    project_or_404,
)
from .job_serialization import safe_generation_output
from .provider_security import (
    resolve_provider_secret,
    validate_provider_target,
)
from .schemas import (
    GenerationOutputEdit,
    JobCreate,
)

router = APIRouter()


def scope_number(scope: dict, key: str) -> int:
    value = scope.get(key)
    if type(value) is not int or value < 1:
        raise KeyframePlanError(f"分镜范围缺少有效的 {key}。")
    return value


def find_script_dialogue(
    script: ScriptRelease, episode_number: int, scene_number: int, dialogue_number: int
) -> dict:
    for episode in script.episodes:
        if episode.get("episode_number") != episode_number:
            continue
        for scene in episode.get("scenes", []):
            if scene.get("scene_number") != scene_number:
                continue
            for line in scene.get("dialogues", []):
                if line.get("dialogue_number") == dialogue_number:
                    return line
    raise KeyframePlanError("对白编号不属于当前已验收剧本版本。")


@router.post("/projects/{project_id}/jobs", status_code=202)
def create_job(project_id: str, data: JobCreate, db: Session = Depends(get_db)):
    project = project_or_404(db, project_id)
    existing = db.scalar(
        select(GenerationJob).where(
            GenerationJob.project_id == project_id,
            GenerationJob.idempotency_key == data.idempotency_key,
        )
    )
    if existing:
        return replay_generation_job(db, existing, data)
    profile = db.get(ServiceProfile, data.profile_id)
    if not profile or profile.project_id != project_id:
        raise HTTPException(404, "service_profile_not_found")
    if not profile.enabled:
        raise HTTPException(409, "service_profile_not_enabled_or_tested")
    if profile.modality != data.modality:
        raise HTTPException(422, "profile_modality_mismatch")
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == data.stage_key
        )
    )
    if not stage:
        raise HTTPException(404, "stage_not_found")
    if stage.status != "running":
        raise HTTPException(409, f"stage_must_be_running_before_generation:{stage.status}")
    if data.stage_key == "novelDraft":
        ordinal = data.scope.get("chapter_ordinal")
        if project.creation_mode != "original":
            raise HTTPException(422, "novel_draft_requires_original_project")
        if type(ordinal) is not int or ordinal < 1:
            raise HTTPException(422, "novel_chapter_ordinal_required")
        existing_ordinals = db.scalars(
            select(Chapter.ordinal).where(Chapter.project_id == project_id)
        ).all()
        highest_ordinal = max(existing_ordinals, default=0)
        if ordinal > highest_ordinal + 1:
            raise HTTPException(422, "novel_chapter_sequence_cannot_skip_ahead")
    if data.stage_key == "continuity":
        chapter_start = data.scope.get("chapter_start")
        chapter_end = data.scope.get("chapter_end")
        if project.creation_mode != "original":
            raise HTTPException(422, "continuity_report_requires_original_project")
        if (
            type(chapter_start) is not int
            or type(chapter_end) is not int
            or chapter_start < 1
            or chapter_end < chapter_start
            or chapter_end - chapter_start >= 20
        ):
            raise HTTPException(422, "continuity_scope_must_include_one_to_twenty_chapters")
        latest_chapters = _latest_chapters(db, project_id)
        context_ordinal = chapter_start - 1 if chapter_start > 1 else None
        chapter_texts = {
            ordinal: latest_chapters[ordinal].body
            for ordinal in range(chapter_start, chapter_end + 1)
            if ordinal in latest_chapters
        }
        if context_ordinal is not None:
            if context_ordinal not in latest_chapters:
                raise HTTPException(422, "continuity_scope_requires_preceding_chapter_context")
            chapter_texts[context_ordinal] = latest_chapters[context_ordinal].body
        if set(chapter_texts) != set(range(chapter_start, chapter_end + 1)):
            raise HTTPException(422, "continuity_scope_chapters_must_be_contiguous")
        chapter_ids = {
            latest_chapters[ordinal].id for ordinal in range(chapter_start, chapter_end + 1)
        }
        if context_ordinal is not None:
            chapter_ids.add(latest_chapters[context_ordinal].id)
        if not chapter_ids.issubset(set(data.input_refs)):
            raise HTTPException(409, "continuity_scope_chapter_versions_changed")
    if data.stage_key == "source" and project.creation_mode == "original":
        scope = data.scope
        release_id = scope.get("release_id")
        episode_count = scope.get("episode_count")
        episode_seconds = scope.get("episode_seconds")
        aspect_ratio = scope.get("aspect_ratio")
        if (
            not isinstance(release_id, str)
            or type(episode_count) is not int
            or type(episode_seconds) is not int
            or not isinstance(aspect_ratio, str)
            or episode_count < 1
            or episode_count > 500
            or episode_seconds < 10
            or episode_seconds > 7200
            or not aspect_ratio.strip()
            or len(aspect_ratio) > 16
        ):
            raise HTTPException(422, "adaptation_mapping_scope_invalid")
        try:
            _, release_chapters = current_release_chapters(db, project, release_id)
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        if episode_count > len(release_chapters):
            raise HTTPException(422, "episode_count_exceeds_locked_chapter_count")
        if not {chapter.id for chapter in release_chapters}.issubset(set(data.input_refs)):
            raise HTTPException(409, "adaptation_mapping_release_chapters_changed")
    if data.stage_key == "outline" and project.creation_mode == "original":
        scope = data.scope
        try:
            branch, _ = current_adaptation_branch(db, project)
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        if (
            scope.get("branch_id") != branch.id
            or scope.get("release_id") != branch.release_id
            or scope.get("branch_revision") != branch.revision
        ):
            raise HTTPException(409, "adaptation_branch_snapshot_changed")
        _, release_chapters = current_release_chapters(db, project, branch.release_id)
        if branch.id not in data.input_refs or not {
            chapter.id for chapter in release_chapters
        }.issubset(set(data.input_refs)):
            raise HTTPException(409, "adaptation_outline_inputs_incomplete")
    if data.stage_key == "script" and project.creation_mode == "original":
        try:
            branch, outline_release, _, character_job, art_job = current_adaptation_script_context(
                db, project
            )
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        scope = data.scope
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline_release.id
            or scope.get("character_job_id") != character_job.id
            or scope.get("art_job_id") != art_job.id
            or scope.get("episode_count") != outline_release.episode_count
        ):
            raise HTTPException(409, "script_upstream_snapshot_changed")
        required_refs = {
            branch.id,
            outline_release.id,
            character_job.id,
            art_job.id,
            *(chapter.id for chapter in release_chapters),
        }
        if not required_refs.issubset(set(data.input_refs)):
            raise HTTPException(409, "script_upstream_inputs_incomplete")
    if data.stage_key == "shotDesign" and project.creation_mode == "original":
        try:
            branch, outline, _, script_release, character_job, art_job = (
                current_adaptation_script_release_context(db, project)
            )
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        scope = data.scope
        required = {branch.id, outline.id, script_release.id, character_job.id, art_job.id}
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline.id
            or scope.get("script_release_id") != script_release.id
            or scope.get("character_job_id") != character_job.id
            or scope.get("art_job_id") != art_job.id
            or not required.issubset(set(data.input_refs))
        ):
            raise HTTPException(409, "storyboard_upstream_snapshot_changed")
    if data.stage_key == "keyframes":
        if data.modality != "image" or profile.adapter_id != "openai-compatible-image":
            raise HTTPException(422, "keyframe_generation_requires_image_adapter")
        try:
            release = current_shot_plan_release(db, project)
            episode_number = scope_number(data.scope, "episode_number")
            scene_number = scope_number(data.scope, "scene_number")
            shot_number = scope_number(data.scope, "shot_number")
            shot = find_shot(release, episode_number, scene_number, shot_number)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        if (
            data.scope.get("shot_plan_release_id") != release.id
            or data.scope.get("base_prompt_hash")
            != hashlib.sha256(shot["visual_prompt"].encode()).hexdigest()
            or not {
                release.id,
                release.job_id,
                release.script_release_id,
                release.character_job_id,
                release.art_job_id,
            }.issubset(set(data.input_refs))
        ):
            raise HTTPException(409, "keyframe_shot_snapshot_changed")
        if set(data.parameters) - {"size", "quality"}:
            raise HTTPException(422, "unsupported_image_generation_parameters")
    video_keyframe = None
    if data.stage_key == "video":
        if data.modality != "video" or profile.adapter_id != "openai-compatible-video":
            raise HTTPException(422, "video_generation_requires_video_adapter")
        if project.creation_mode != "original":
            raise HTTPException(422, "video_generation_requires_original_project")
        try:
            release = current_shot_plan_release(db, project)
            episode_number = scope_number(data.scope, "episode_number")
            scene_number = scope_number(data.scope, "scene_number")
            shot_number = scope_number(data.scope, "shot_number")
            find_shot(release, episode_number, scene_number, shot_number)
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        video_keyframe = db.scalar(
            select(KeyframeCandidate).where(
                KeyframeCandidate.project_id == project_id,
                KeyframeCandidate.shot_plan_release_id == release.id,
                KeyframeCandidate.episode_number == episode_number,
                KeyframeCandidate.scene_number == scene_number,
                KeyframeCandidate.shot_number == shot_number,
                KeyframeCandidate.status == "accepted",
            )
        )
        required_refs = {
            release.id,
            release.job_id,
            release.script_release_id,
            release.character_job_id,
            release.art_job_id,
        }
        if (
            not video_keyframe
            or data.scope.get("shot_plan_release_id") != release.id
            or data.scope.get("keyframe_candidate_id") != video_keyframe.id
            or not required_refs.issubset(set(data.input_refs))
            or video_keyframe.id not in data.input_refs
        ):
            raise HTTPException(409, "video_shot_inputs_changed_or_keyframe_not_accepted")
        if set(data.parameters) - {"seconds", "size"}:
            raise HTTPException(422, "unsupported_video_generation_parameters")
        if data.parameters.get("seconds") not in {4, 6, 8, 12}:
            raise HTTPException(422, "unsupported_video_duration")
        if data.parameters.get("size") not in {"1280x720", "720x1280", "1024x1024"}:
            raise HTTPException(422, "unsupported_video_size")
    audio_dialogue = None
    audio_script = None
    audio_branch = None
    if data.stage_key == "voice":
        if data.modality != "audio" or profile.adapter_id != "openai-compatible-audio":
            raise HTTPException(422, "voice_generation_requires_audio_adapter")
        if project.creation_mode != "original":
            raise HTTPException(422, "voice_generation_requires_locked_script")
        script_stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == "script"
            )
        )
        script_id = (
            (script_stage.decision or {}).get("script_release_id")
            if script_stage and script_stage.status == "accepted"
            else None
        )
        audio_script = db.get(ScriptRelease, script_id) if script_id else None
        if not audio_script:
            raise HTTPException(409, "accepted_script_release_required")
        audio_branch = db.get(AdaptationBranch, audio_script.branch_id)
        if not audio_branch or audio_branch.project_id != project_id:
            raise HTTPException(409, "script_branch_snapshot_invalid")
        try:
            episode_number = scope_number(data.scope, "episode_number")
            scene_number = scope_number(data.scope, "scene_number")
            dialogue_number = scope_number(data.scope, "dialogue_number")
            audio_dialogue = find_script_dialogue(
                audio_script, episode_number, scene_number, dialogue_number
            )
        except KeyframePlanError as error:
            raise HTTPException(409, str(error)) from None
        if (
            data.scope.get("script_release_id") != audio_script.id
            or data.scope.get("base_text_hash")
            != hashlib.sha256(audio_dialogue["text"].encode("utf-8")).hexdigest()
            or data.prompt != audio_dialogue["text"]
            or not {audio_script.id, audio_script.job_id}.issubset(set(data.input_refs))
        ):
            raise HTTPException(409, "voice_dialogue_snapshot_changed")
        if set(data.parameters) - {"voice", "response_format", "speed"}:
            raise HTTPException(422, "unsupported_speech_parameters")
        if data.parameters.get("response_format", "mp3") not in {
            "mp3",
            "wav",
            "opus",
            "aac",
            "flac",
        }:
            raise HTTPException(422, "unsupported_speech_format")
        speed = data.parameters.get("speed", 1.0)
        if (
            isinstance(speed, bool)
            or not isinstance(speed, (int, float))
            or not 0.25 <= speed <= 4.0
        ):
            raise HTTPException(422, "unsupported_speech_speed")
    if data.stage_key in {"characters", "art"} and project.creation_mode == "original":
        try:
            branch, outline_release, _ = current_adaptation_outline_context(db, project)
        except EpisodeSourceMappingError as error:
            raise HTTPException(409, str(error)) from None
        scope = data.scope
        required_refs = {branch.id, outline_release.id, outline_release.job_id}
        if (
            scope.get("branch_id") != branch.id
            or scope.get("outline_release_id") != outline_release.id
        ):
            raise HTTPException(409, "adaptation_asset_scope_changed")
        if data.stage_key == "art":
            character_stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id,
                    StageState.stage_key == "characters",
                )
            )
            character_job_id = (
                (character_stage.decision or {}).get("candidate_job_id")
                if character_stage
                else None
            )
            if (
                character_stage is None
                or character_stage.status != "accepted"
                or not character_job_id
            ):
                raise HTTPException(409, "accepted_video_character_constraints_required")
            scope_character_id = scope.get("character_job_id")
            if scope_character_id != character_job_id:
                raise HTTPException(409, "accepted_character_snapshot_changed")
            required_refs.add(character_job_id)
        if not required_refs.issubset(set(data.input_refs)):
            raise HTTPException(409, "adaptation_asset_inputs_incomplete")
    if not data.data_authorized:
        raise HTTPException(422, "model_data_processing_consent_required")
    supported = (data.modality == "text" and profile.adapter_id == "openai-compatible-chat") or (
        data.modality == "image"
        and data.stage_key == "keyframes"
        and profile.adapter_id == "openai-compatible-image"
    )
    supported = supported or (
        data.modality == "video"
        and data.stage_key == "video"
        and profile.adapter_id == "openai-compatible-video"
    )
    supported = supported or (
        data.modality == "audio"
        and data.stage_key == "voice"
        and profile.adapter_id == "openai-compatible-audio"
    )
    if not supported:
        job = GenerationJob(
            project_id=project_id,
            modality=data.modality,
            stage_key=data.stage_key,
            status="blocked",
            idempotency_key=data.idempotency_key,
            input_snapshot={
                "prompt": data.prompt,
                "parameters": data.parameters,
                "input_refs": data.input_refs,
                "scope": data.scope,
                "data_authorized": data.data_authorized,
            },
            provider_snapshot={
                "profile_id": profile.id,
                "profile_version": profile.version,
                "adapter_id": profile.adapter_id,
                "model_id": profile.model_id,
            },
            error={
                "code": "adapter_not_registered",
                "message": "该模态的生成 Adapter 尚未接入；未向外部服务发送数据。",
            },
        )
        db.add(job)
        stage.status = "failed"
        stage.version += 1
        audit(db, project_id, "job.blocked", job.id, job.error)
        audit(
            db,
            project_id,
            "stage.execution_failed",
            stage.id,
            {"stage_key": stage.stage_key, "reason": "adapter_not_registered"},
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.scalar(
                select(GenerationJob).where(
                    GenerationJob.project_id == project_id,
                    GenerationJob.idempotency_key == data.idempotency_key,
                )
            )
            if existing:
                return replay_generation_job(db, existing, data)
            raise HTTPException(409, "generation_job_conflict") from None
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }

    secret = resolve_provider_secret(profile.secret_ref)
    if profile.secret_ref and not secret:
        raise HTTPException(409, "provider_secret_reference_not_configured")
    completion_url = profile.endpoint.rstrip("/")
    parsed = urlsplit(completion_url)
    if not parsed.path.rstrip("/").endswith("/chat/completions"):
        if parsed.path.rstrip("/").endswith("/models"):
            completion_url = completion_url[: -len("/models")]
        elif not parsed.path.rstrip("/").endswith("/v1"):
            completion_url = f"{completion_url}/v1"
        completion_url = f"{completion_url}/chat/completions"
    target_url = (
        profile.endpoint if data.modality in {"image", "video", "audio"} else completion_url
    )
    target_ips = validate_provider_target(target_url, profile.transport)
    job = GenerationJob(
        project_id=project_id,
        modality=data.modality,
        stage_key=data.stage_key,
        status="running",
        idempotency_key=data.idempotency_key,
        input_snapshot={
            "prompt": data.prompt,
            "parameters": data.parameters,
            "input_refs": data.input_refs,
            "scope": data.scope,
            "data_authorized": data.data_authorized,
            "stage_version": stage.version,
        },
        provider_snapshot={
            "profile_id": profile.id,
            "profile_version": profile.version,
            "adapter_id": profile.adapter_id,
            "model_id": profile.model_id,
            "endpoint": profile.endpoint,
        },
        error={},
    )
    db.add(job)
    audit(
        db,
        project_id,
        "job.started",
        job.id,
        {"stage_key": data.stage_key, "modality": data.modality, "profile_id": profile.id},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(GenerationJob).where(
                GenerationJob.project_id == project_id,
                GenerationJob.idempotency_key == data.idempotency_key,
            )
        )
        if existing:
            return replay_generation_job(db, existing, data)
        raise HTTPException(409, "generation_job_conflict") from None
    try:
        image_result = None
        video_task = None
        audio_result = None
        if data.modality == "image":
            image_result = generate_image(
                endpoint=profile.endpoint,
                target_ip=target_ips[0],
                model_id=profile.model_id,
                secret=secret,
                prompt=data.prompt,
                size=str(data.parameters.get("size", "1024x1024")),
                quality=data.parameters.get("quality"),
            )
            _, _, usage = image_result
            content = ""
        elif data.modality == "video":
            if not video_keyframe:
                raise HTTPException(409, "accepted_keyframe_required")
            reference_path = (settings.storage_dir / video_keyframe.storage_key).resolve()
            if (
                settings.storage_dir.resolve() not in reference_path.parents
                or not reference_path.is_file()
            ):
                raise HTTPException(409, "accepted_keyframe_file_missing")
            video_task = submit_video(
                endpoint=profile.endpoint,
                target_ip=target_ips[0],
                model_id=profile.model_id,
                secret=secret,
                prompt=data.prompt,
                input_reference=reference_path.read_bytes(),
                input_content_type=video_keyframe.content_type,
                seconds=int(data.parameters["seconds"]),
                size=str(data.parameters["size"]),
            )
            content = ""
            usage = {}
        elif data.modality == "audio":
            if not audio_dialogue:
                raise HTTPException(409, "accepted_script_dialogue_required")
            audio_result = generate_speech(
                endpoint=profile.endpoint,
                target_ip=target_ips[0],
                model_id=profile.model_id,
                secret=secret,
                text=data.prompt,
                voice=str(data.parameters.get("voice", "alloy")),
                response_format=str(data.parameters.get("response_format", "mp3")),
                speed=float(data.parameters.get("speed", 1.0)),
            )
            content = ""
            usage = {}
        else:
            content, usage = complete_chat(
                endpoint=completion_url,
                target_ip=target_ips[0],
                model_id=profile.model_id,
                secret=secret,
                prompt=data.prompt,
                parameters=data.parameters,
            )
    except ProviderExecutionError as error:
        db.expire_all()
        stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == data.stage_key
            )
        )
        job.error = {"code": error.code, "provider_status": error.http_status}
        current_execution = bool(
            stage
            and stage.status == "running"
            and stage.version == job.input_snapshot["stage_version"]
        )
        job.status = "failed" if current_execution else "stale"
        if current_execution and stage:
            stage.status = "failed"
            stage.version += 1
        audit(
            db,
            project_id,
            "job.failed" if current_execution else "job.result_stale",
            job.id,
            job.error,
        )
        db.commit()
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }
    except HTTPException as error:
        db.expire_all()
        stage = db.scalar(
            select(StageState).where(
                StageState.project_id == project_id, StageState.stage_key == data.stage_key
            )
        )
        job.error = {"code": str(error.detail)}
        current_execution = bool(
            stage
            and stage.status == "running"
            and stage.version == job.input_snapshot["stage_version"]
        )
        job.status = "failed" if current_execution else "stale"
        if current_execution and stage:
            stage.status = "failed"
            stage.version += 1
        audit(
            db,
            project_id,
            "job.failed" if current_execution else "job.result_stale",
            job.id,
            job.error,
        )
        db.commit()
        return {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "provider_snapshot": job.provider_snapshot,
        }
    db.expire_all()
    if data.stage_key == "novelDraft":
        try:
            expected_ordinal = data.scope.get("chapter_ordinal")
            if not isinstance(expected_ordinal, int) or expected_ordinal < 1:
                raise NovelDraftCandidateError("章节任务缺少有效的目标序号。")
            parse_chapter_candidate(content, expected_ordinal)
        except NovelDraftCandidateError as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_novel_chapter_candidate", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    if data.stage_key == "shotDesign" and project.creation_mode == "original":
        try:
            branch, outline_release, outline_episodes, script_release, character_job, art_job = (
                current_adaptation_script_release_context(db, project)
            )
            scope = job.input_snapshot.get("scope") or {}
            if (
                scope.get("branch_id") != branch.id
                or scope.get("outline_release_id") != outline_release.id
                or scope.get("script_release_id") != script_release.id
            ):
                raise EpisodeSourceMappingError("分镜候选引用的剧本版本已变化。")
            parse_storyboard_plan(
                content,
                branch_id=branch.id,
                script_release_id=script_release.id,
                character_job_id=character_job.id,
                art_job_id=art_job.id,
                script_episodes=script_release.episodes,
                outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
            )
        except (EpisodeSourceMappingError, KeyError) as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_storyboard_plan", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    if data.stage_key == "continuity":
        try:
            _validate_continuity_output(db, project_id, job, content, allow_review_decisions=False)
        except ContinuityReportError as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_continuity_report", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    if data.stage_key == "source" and project.creation_mode == "original":
        try:
            scope = job.input_snapshot.get("scope") or {}
            _, release_chapters = current_release_chapters(
                db, project, str(scope.get("release_id", ""))
            )
            parse_episode_source_mapping(
                content,
                expected_release_id=scope["release_id"],
                expected_episode_count=scope["episode_count"],
                expected_episode_seconds=scope["episode_seconds"],
                expected_aspect_ratio=scope["aspect_ratio"],
                allowed_chapter_ordinals={chapter.ordinal for chapter in release_chapters},
            )
        except (EpisodeSourceMappingError, KeyError) as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_episode_source_mapping", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    if data.stage_key == "outline" and project.creation_mode == "original":
        try:
            branch, mappings = current_adaptation_branch(db, project)
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
            scope = job.input_snapshot.get("scope") or {}
            if scope.get("branch_id") != branch.id:
                raise EpisodeSourceMappingError("改编分支已变化，大纲候选已失效。")
            parse_adaptation_outline(
                content,
                branch_id=branch.id,
                release_id=branch.release_id,
                episode_seconds=branch.episode_seconds,
                aspect_ratio=branch.aspect_ratio,
                mappings=[{"chapter_ordinals": mapping.chapter_ordinals} for mapping in mappings],
            )
            if not {chapter.id for chapter in release_chapters}.issubset(
                set(job.input_snapshot.get("input_refs", []))
            ):
                raise EpisodeSourceMappingError("锁版章节输入引用已变化。")
        except EpisodeSourceMappingError as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_adaptation_outline", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    if data.stage_key == "script" and project.creation_mode == "original":
        try:
            branch, outline_release, outline_episodes, character_job, art_job = (
                current_adaptation_script_context(db, project)
            )
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
            scope = job.input_snapshot.get("scope") or {}
            if (
                scope.get("branch_id") != branch.id
                or scope.get("outline_release_id") != outline_release.id
            ):
                raise EpisodeSourceMappingError("剧本上游版本已变化，当前候选不可用。")
            parse_script_candidate(
                content,
                branch_id=branch.id,
                release_id=branch.release_id,
                outline_release_id=outline_release.id,
                character_job_id=character_job.id,
                art_job_id=art_job.id,
                outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
                chapter_bodies={chapter.ordinal: chapter.body for chapter in release_chapters},
            )
        except EpisodeSourceMappingError as error:
            stage = db.scalar(
                select(StageState).where(
                    StageState.project_id == project_id, StageState.stage_key == data.stage_key
                )
            )
            job.status = "failed"
            job.error = {"code": "invalid_episode_script", "message": str(error)}
            if (
                stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
            ):
                stage.status = "failed"
                stage.version += 1
            audit(db, project_id, "job.failed", job.id, job.error)
            db.commit()
            return {
                "id": job.id,
                "status": job.status,
                "error": job.error,
                "provider_snapshot": job.provider_snapshot,
            }
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == data.stage_key
        )
    )
    keyframe_candidate = None
    if (
        image_result
        and stage
        and stage.status == "running"
        and stage.version == job.input_snapshot["stage_version"]
    ):
        image_bytes, image_type, _ = image_result
        extension = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[image_type]
        asset_id = str(uuid4())
        relative_key = f"generated/{project_id}/{asset_id}{extension}"
        path = settings.storage_dir / relative_key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image_bytes)
        scope = job.input_snapshot.get("scope") or {}
        release = current_shot_plan_release(db, project)
        keyframe_candidate = KeyframeCandidate(
            project_id=project_id,
            branch_id=release.branch_id,
            shot_plan_release_id=release.id,
            job_id=job.id,
            episode_number=scope["episode_number"],
            scene_number=scope["scene_number"],
            shot_number=scope["shot_number"],
            storage_key=relative_key,
            content_type=image_type,
            size_bytes=len(image_bytes),
            sha256=hashlib.sha256(image_bytes).hexdigest(),
            prompt=job.input_snapshot["prompt"],
            provider_snapshot=job.provider_snapshot,
        )
        db.add(keyframe_candidate)
        db.flush()
        media_url = f"/api/projects/{project_id}/keyframe-candidates/{keyframe_candidate.id}/file"
        content = json.dumps(
            {
                "keyframe_candidate_id": keyframe_candidate.id,
                "shot_plan_release_id": release.id,
                "episode_number": keyframe_candidate.episode_number,
                "scene_number": keyframe_candidate.scene_number,
                "shot_number": keyframe_candidate.shot_number,
                "media_url": media_url,
                "content_type": image_type,
                "sha256": keyframe_candidate.sha256,
            }
        )
    video_candidate = None
    if video_task and video_keyframe:
        release = current_shot_plan_release(db, project)
        scope = job.input_snapshot.get("scope") or {}
        video_candidate = VideoCandidate(
            project_id=project_id,
            branch_id=release.branch_id,
            shot_plan_release_id=release.id,
            keyframe_candidate_id=video_keyframe.id,
            job_id=job.id,
            provider_task_id=video_task.task_id,
            episode_number=scope["episode_number"],
            scene_number=scope["scene_number"],
            shot_number=scope["shot_number"],
            requested_seconds=int(job.input_snapshot["parameters"]["seconds"]),
            progress=video_task.progress,
            prompt=job.input_snapshot["prompt"],
            provider_snapshot=job.provider_snapshot,
            status=(
                "processing"
                if stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
                else "stale"
            ),
        )
        db.add(video_candidate)
        db.flush()
        content = json.dumps(
            {
                "video_candidate_id": video_candidate.id,
                "provider_task_id": video_task.task_id,
                "status": video_task.status,
                "progress": video_task.progress,
                "keyframe_candidate_id": video_keyframe.id,
            }
        )
    audio_candidate = None
    if audio_result and audio_dialogue and audio_script and audio_branch:
        audio_bytes, audio_type = audio_result
        extension = {
            "audio/mpeg": ".mp3",
            "audio/wav": ".wav",
            "audio/ogg": ".ogg",
            "audio/aac": ".aac",
            "audio/flac": ".flac",
        }[audio_type]
        relative_key = f"generated/{project_id}/{uuid4()}{extension}"
        audio_path = settings.storage_dir / relative_key
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(audio_bytes)
        scope = job.input_snapshot.get("scope") or {}
        audio_candidate = AudioCandidate(
            project_id=project_id,
            branch_id=audio_branch.id,
            script_release_id=audio_script.id,
            job_id=job.id,
            episode_number=scope["episode_number"],
            scene_number=scope["scene_number"],
            dialogue_number=scope["dialogue_number"],
            storage_key=relative_key,
            content_type=audio_type,
            size_bytes=len(audio_bytes),
            sha256=hashlib.sha256(audio_bytes).hexdigest(),
            text=job.input_snapshot["prompt"],
            voice_id=str(job.input_snapshot["parameters"].get("voice", "alloy")),
            provider_snapshot=job.provider_snapshot,
            status=(
                "needs_review"
                if stage
                and stage.status == "running"
                and stage.version == job.input_snapshot["stage_version"]
                else "stale"
            ),
        )
        db.add(audio_candidate)
        db.flush()
        content = json.dumps(
            {
                "audio_candidate_id": audio_candidate.id,
                "script_release_id": audio_script.id,
                "episode_number": audio_candidate.episode_number,
                "scene_number": audio_candidate.scene_number,
                "dialogue_number": audio_candidate.dialogue_number,
                "content_type": audio_type,
                "size_bytes": audio_candidate.size_bytes,
                "sha256": audio_candidate.sha256,
            }
        )
    output = GenerationOutput(
        project_id=project_id,
        job_id=job.id,
        content_type="application/json"
        if data.stage_key in {"novelDraft", "continuity", "video", "voice"}
        or (data.stage_key == "source" and project.creation_mode == "original")
        or (data.stage_key == "outline" and project.creation_mode == "original")
        or (data.stage_key == "script" and project.creation_mode == "original")
        or (data.stage_key == "shotDesign" and project.creation_mode == "original")
        or data.stage_key == "keyframes"
        else "text/markdown",
        content=content,
        metadata_json={"usage": usage},
    )
    db.add(output)
    if (
        not stage
        or stage.status != "running"
        or stage.version != job.input_snapshot["stage_version"]
    ):
        job.status = "stale"
        audit(
            db,
            project_id,
            "job.result_stale",
            job.id,
            {"stage_key": data.stage_key, "output_id": output.id},
        )
    else:
        if video_candidate:
            stage.decision = {"candidate_job_id": job.id, "video_candidate_id": video_candidate.id}
            audit(
                db,
                project_id,
                "video.task_submitted",
                video_candidate.id,
                {
                    "job_id": job.id,
                    "provider_task_id": video_task.task_id,
                },
            )
        elif audio_candidate:
            job.status = "succeeded"
            stage.status = "needs_review"
            stage.version += 1
            stage.stale = False
            stage.decision = {
                "candidate_job_id": job.id,
                "audio_candidate_id": audio_candidate.id,
            }
            audit(
                db,
                project_id,
                "voice.candidate_created",
                audio_candidate.id,
                {
                    "job_id": job.id,
                    "episode_number": audio_candidate.episode_number,
                    "scene_number": audio_candidate.scene_number,
                    "dialogue_number": audio_candidate.dialogue_number,
                },
            )
        else:
            job.status = "succeeded"
            stage.status = "needs_review"
            stage.version += 1
            stage.stale = False
            stage.decision = {"candidate_job_id": job.id}
            audit(db, project_id, "job.succeeded", job.id, {"output_id": output.id, "usage": usage})
            audit(
                db,
                project_id,
                "stage.candidate_created",
                stage.id,
                {"stage_key": stage.stage_key, "job_id": job.id, "output_id": output.id},
            )
    db.commit()
    return {
        "id": job.id,
        "status": job.status,
        "output": safe_generation_output(output),
        "provider_snapshot": job.provider_snapshot,
    }


@router.put("/projects/{project_id}/jobs/{job_id}/output")
def edit_generation_output(
    project_id: str, job_id: str, data: GenerationOutputEdit, db: Session = Depends(get_db)
):
    project_or_404(db, project_id)
    job = db.scalar(
        select(GenerationJob).where(
            GenerationJob.id == job_id, GenerationJob.project_id == project_id
        )
    )
    if not job:
        raise HTTPException(404, "generation_job_not_found")
    output = db.scalar(
        select(GenerationOutput).where(
            GenerationOutput.job_id == job_id, GenerationOutput.project_id == project_id
        )
    )
    stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id, StageState.stage_key == job.stage_key
        )
    )
    if not output or job.status != "succeeded" or not stage:
        raise HTTPException(409, "generation_output_not_editable")
    if output.revision != data.revision:
        raise HTTPException(409, "generation_output_revision_conflict")
    if stage.status != "needs_review" or (stage.decision or {}).get("candidate_job_id") != job_id:
        raise HTTPException(409, "generation_candidate_is_not_current")
    if job.stage_key == "novelDraft":
        expected_ordinal = (job.input_snapshot.get("scope") or {}).get("chapter_ordinal")
        try:
            if not isinstance(expected_ordinal, int):
                raise NovelDraftCandidateError("章节任务缺少有效的目标序号。")
            parse_chapter_candidate(data.content, expected_ordinal)
        except NovelDraftCandidateError as error:
            raise HTTPException(422, str(error)) from None
    if job.stage_key == "continuity":
        try:
            _validate_continuity_output(
                db, project_id, job, data.content, allow_review_decisions=True
            )
        except ContinuityReportError as error:
            raise HTTPException(422, str(error)) from None
    if job.stage_key == "source":
        project = project_or_404(db, project_id)
        if project.creation_mode == "original":
            try:
                scope = job.input_snapshot.get("scope") or {}
                _, release_chapters = current_release_chapters(
                    db, project, str(scope.get("release_id", ""))
                )
                parse_episode_source_mapping(
                    data.content,
                    expected_release_id=scope["release_id"],
                    expected_episode_count=scope["episode_count"],
                    expected_episode_seconds=scope["episode_seconds"],
                    expected_aspect_ratio=scope["aspect_ratio"],
                    allowed_chapter_ordinals={chapter.ordinal for chapter in release_chapters},
                )
            except (EpisodeSourceMappingError, KeyError) as error:
                raise HTTPException(422, str(error)) from None
    if job.stage_key == "outline":
        project = project_or_404(db, project_id)
        if project.creation_mode == "original":
            try:
                branch, mappings = current_adaptation_branch(db, project)
                scope = job.input_snapshot.get("scope") or {}
                if scope.get("branch_id") != branch.id:
                    raise EpisodeSourceMappingError("改编分支已变化，大纲候选已失效。")
                parse_adaptation_outline(
                    data.content,
                    branch_id=branch.id,
                    release_id=branch.release_id,
                    episode_seconds=branch.episode_seconds,
                    aspect_ratio=branch.aspect_ratio,
                    mappings=[
                        {"chapter_ordinals": mapping.chapter_ordinals} for mapping in mappings
                    ],
                )
            except (EpisodeSourceMappingError, KeyError) as error:
                raise HTTPException(422, str(error)) from None
    if job.stage_key == "script":
        project = project_or_404(db, project_id)
        if project.creation_mode == "original":
            try:
                branch, outline_release, outline_episodes, character_job, art_job = (
                    current_adaptation_script_context(db, project)
                )
                _, release_chapters = current_release_chapters(db, project, branch.release_id)
                scope = job.input_snapshot.get("scope") or {}
                if (
                    scope.get("branch_id") != branch.id
                    or scope.get("outline_release_id") != outline_release.id
                ):
                    raise EpisodeSourceMappingError("剧本上游版本已变化。")
                parse_script_candidate(
                    data.content,
                    branch_id=branch.id,
                    release_id=branch.release_id,
                    outline_release_id=outline_release.id,
                    character_job_id=character_job.id,
                    art_job_id=art_job.id,
                    outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
                    chapter_bodies={chapter.ordinal: chapter.body for chapter in release_chapters},
                )
            except (EpisodeSourceMappingError, KeyError) as error:
                raise HTTPException(422, str(error)) from None
    if job.stage_key == "shotDesign":
        project = project_or_404(db, project_id)
        if project.creation_mode == "original":
            try:
                (
                    branch,
                    outline_release,
                    outline_episodes,
                    script_release,
                    character_job,
                    art_job,
                ) = current_adaptation_script_release_context(db, project)
                scope = job.input_snapshot.get("scope") or {}
                if scope.get("script_release_id") != script_release.id:
                    raise EpisodeSourceMappingError("剧本上游版本已变化。")
                parse_storyboard_plan(
                    data.content,
                    branch_id=branch.id,
                    script_release_id=script_release.id,
                    character_job_id=character_job.id,
                    art_job_id=art_job.id,
                    script_episodes=script_release.episodes,
                    outline_episodes=[{"scenes": episode.scenes} for episode in outline_episodes],
                )
            except (EpisodeSourceMappingError, KeyError) as error:
                raise HTTPException(422, str(error)) from None
    db.add(
        GenerationOutputVersion(
            output_id=output.id,
            revision=output.revision,
            content=output.content,
        )
    )
    output.content = data.content
    output.revision += 1
    stage.version += 1
    audit(
        db,
        project_id,
        "generation_output.edited",
        output.id,
        {
            "job_id": job.id,
            "stage_key": job.stage_key,
            "revision": output.revision,
        },
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "generation_output_revision_conflict") from None
    db.refresh(output)
    return safe_generation_output(output)


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


def _validate_continuity_output(
    db: Session,
    project_id: str,
    job: GenerationJob,
    content: str,
    *,
    allow_review_decisions: bool,
):
    scope = job.input_snapshot.get("scope") or {}
    chapter_start = scope.get("chapter_start")
    chapter_end = scope.get("chapter_end")
    if type(chapter_start) is not int or type(chapter_end) is not int:
        raise ContinuityReportError("审校任务缺少有效的章节范围。")
    latest_chapters = _latest_chapters(db, project_id)
    chapter_texts = {
        ordinal: latest_chapters[ordinal].body
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in latest_chapters
    }
    context_ordinal = scope.get("context_chapter")
    if type(context_ordinal) is int:
        if context_ordinal not in latest_chapters:
            raise ContinuityReportError("审校上下文章节版本已变化。")
        chapter_texts[context_ordinal] = latest_chapters[context_ordinal].body
    latest_ids = {
        latest_chapters[ordinal].id
        for ordinal in range(chapter_start, chapter_end + 1)
        if ordinal in latest_chapters
    }
    if type(context_ordinal) is int and context_ordinal in latest_chapters:
        latest_ids.add(latest_chapters[context_ordinal].id)
    if not latest_ids.issubset(set(job.input_snapshot.get("input_refs", []))):
        raise ContinuityReportError("审校期间章节版本已变化，请重新运行审校。")
    return parse_continuity_report(
        content,
        chapter_start,
        chapter_end,
        chapter_texts,
        allow_review_decisions=allow_review_decisions,
    )


def replay_generation_job(db: Session, job: GenerationJob, data: JobCreate) -> dict:
    if (
        job.stage_key != data.stage_key
        or job.modality != data.modality
        or job.input_snapshot.get("prompt") != data.prompt
        or job.input_snapshot.get("parameters", {}) != data.parameters
        or job.input_snapshot.get("input_refs", []) != data.input_refs
        or job.input_snapshot.get("scope", {}) != data.scope
        or job.input_snapshot.get("data_authorized", False) != data.data_authorized
        or job.provider_snapshot.get("profile_id") != data.profile_id
    ):
        raise HTTPException(409, "idempotency_key_reused_with_different_request")
    output = db.scalar(select(GenerationOutput).where(GenerationOutput.job_id == job.id))
    return {
        "id": job.id,
        "status": job.status,
        "idempotent_replay": True,
        "output": safe_generation_output(output) if output else None,
        "error": job.error,
    }
