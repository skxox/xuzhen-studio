from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import Chapter, GenerationJob, Project
from .adaptation_mapping import (
    EpisodeSourceMappingError,
    current_adaptation_branch,
    current_adaptation_script_context,
    current_adaptation_script_release_context,
    current_release_chapters,
    parse_adaptation_outline,
    parse_episode_source_mapping,
    parse_script_candidate,
    parse_storyboard_plan,
)
from .continuity import ContinuityReportError, parse_continuity_report
from .novel_draft import NovelDraftCandidateError, parse_chapter_candidate


class GenerationCandidateValidationError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def latest_project_chapters(db: Session, project_id: str) -> dict[int, Chapter]:
    items = db.scalars(
        select(Chapter)
        .where(Chapter.project_id == project_id)
        .order_by(Chapter.ordinal, Chapter.version.desc())
    ).all()
    latest: dict[int, Chapter] = {}
    for item in items:
        latest.setdefault(item.ordinal, item)
    return latest


def validate_generation_candidate(
    db: Session,
    project: Project,
    job: GenerationJob,
    content: str,
    *,
    allow_review_decisions: bool,
) -> None:
    scope = job.input_snapshot.get("scope") or {}
    input_refs = set(job.input_snapshot.get("input_refs", []))

    if job.stage_key == "novelDraft":
        expected_ordinal = scope.get("chapter_ordinal")
        try:
            if type(expected_ordinal) is not int or expected_ordinal < 1:
                raise NovelDraftCandidateError("章节任务缺少有效的目标序号。")
            parse_chapter_candidate(content, expected_ordinal)
        except NovelDraftCandidateError as error:
            raise GenerationCandidateValidationError(
                "invalid_novel_chapter_candidate", str(error)
            ) from None

    if job.stage_key == "continuity":
        try:
            validate_continuity_candidate(
                db,
                project.id,
                job,
                content,
                allow_review_decisions=allow_review_decisions,
            )
        except ContinuityReportError as error:
            raise GenerationCandidateValidationError(
                "invalid_continuity_report", str(error)
            ) from None

    if project.creation_mode != "original":
        return

    if job.stage_key == "source":
        try:
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
            if not {chapter.id for chapter in release_chapters}.issubset(input_refs):
                raise EpisodeSourceMappingError("锁版章节输入引用已变化。")
        except (EpisodeSourceMappingError, KeyError) as error:
            raise GenerationCandidateValidationError(
                "invalid_episode_source_mapping", str(error)
            ) from None

    if job.stage_key == "outline":
        try:
            branch, mappings = current_adaptation_branch(db, project)
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
            if (
                scope.get("branch_id") != branch.id
                or scope.get("release_id") != branch.release_id
                or scope.get("branch_revision") != branch.revision
            ):
                raise EpisodeSourceMappingError("改编分支已变化，大纲候选已失效。")
            if branch.id not in input_refs or not {
                chapter.id for chapter in release_chapters
            }.issubset(input_refs):
                raise EpisodeSourceMappingError("锁版章节输入引用已变化。")
            parse_adaptation_outline(
                content,
                branch_id=branch.id,
                release_id=branch.release_id,
                episode_seconds=branch.episode_seconds,
                aspect_ratio=branch.aspect_ratio,
                mappings=[{"chapter_ordinals": mapping.chapter_ordinals} for mapping in mappings],
            )
        except (EpisodeSourceMappingError, KeyError) as error:
            raise GenerationCandidateValidationError(
                "invalid_adaptation_outline", str(error)
            ) from None

    if job.stage_key == "script":
        try:
            branch, outline_release, outline_episodes, character_job, art_job = (
                current_adaptation_script_context(db, project)
            )
            _, release_chapters = current_release_chapters(db, project, branch.release_id)
            if (
                scope.get("branch_id") != branch.id
                or scope.get("outline_release_id") != outline_release.id
                or scope.get("character_job_id") != character_job.id
                or scope.get("art_job_id") != art_job.id
                or scope.get("episode_count") != outline_release.episode_count
            ):
                raise EpisodeSourceMappingError("剧本上游版本已变化，当前候选不可用。")
            required_refs = {
                branch.id,
                outline_release.id,
                character_job.id,
                art_job.id,
                *(chapter.id for chapter in release_chapters),
            }
            if not required_refs.issubset(input_refs):
                raise EpisodeSourceMappingError("剧本上游输入引用已变化。")
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
            raise GenerationCandidateValidationError("invalid_episode_script", str(error)) from None

    if job.stage_key == "shotDesign":
        try:
            branch, outline_release, outline_episodes, script_release, character_job, art_job = (
                current_adaptation_script_release_context(db, project)
            )
            required_refs = {
                branch.id,
                outline_release.id,
                script_release.id,
                character_job.id,
                art_job.id,
            }
            if (
                scope.get("branch_id") != branch.id
                or scope.get("outline_release_id") != outline_release.id
                or scope.get("script_release_id") != script_release.id
                or scope.get("character_job_id") != character_job.id
                or scope.get("art_job_id") != art_job.id
                or not required_refs.issubset(input_refs)
            ):
                raise EpisodeSourceMappingError("分镜候选引用的上游版本已变化。")
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
            raise GenerationCandidateValidationError(
                "invalid_storyboard_plan", str(error)
            ) from None


def validate_continuity_candidate(
    db: Session,
    project_id: str,
    job: GenerationJob,
    content: str,
    *,
    allow_review_decisions: bool,
) -> None:
    scope = job.input_snapshot.get("scope") or {}
    chapter_start = scope.get("chapter_start")
    chapter_end = scope.get("chapter_end")
    if type(chapter_start) is not int or type(chapter_end) is not int:
        raise ContinuityReportError("审校任务缺少有效的章节范围。")
    latest_chapters = latest_project_chapters(db, project_id)
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
    parse_continuity_report(
        content,
        chapter_start,
        chapter_end,
        chapter_texts,
        allow_review_decisions=allow_review_decisions,
    )
