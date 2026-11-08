from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    AdaptationBranch,
    AdaptationOutlineRelease,
    EpisodeAdaptationOutline,
    EpisodeSourceMapping,
    StageState,
)
from .common import get_db, project_or_404

router = APIRouter()


@router.get("/projects/{project_id}/adaptation-branches")
def list_adaptation_branches(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    source_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "source",
        )
    )
    current_branch_id = (
        (source_stage.decision or {}).get("branch_id")
        if source_stage and source_stage.status == "accepted"
        else None
    )
    branches = db.scalars(
        select(AdaptationBranch)
        .where(AdaptationBranch.project_id == project_id)
        .order_by(AdaptationBranch.revision.desc())
    ).all()
    mapping_rows = (
        db.scalars(
            select(EpisodeSourceMapping)
            .where(EpisodeSourceMapping.branch_id.in_([branch.id for branch in branches]))
            .order_by(EpisodeSourceMapping.episode_number)
        ).all()
        if branches
        else []
    )
    mappings_by_branch: dict[str, list[EpisodeSourceMapping]] = {}
    for mapping in mapping_rows:
        mappings_by_branch.setdefault(mapping.branch_id, []).append(mapping)
    return [
        {
            "id": branch.id,
            "project_id": branch.project_id,
            "release_id": branch.release_id,
            "revision": branch.revision,
            "episode_count": branch.episode_count,
            "episode_seconds": branch.episode_seconds,
            "aspect_ratio": branch.aspect_ratio,
            "previous_branch_id": branch.previous_branch_id,
            "is_current": branch.id == current_branch_id,
            "created_at": branch.created_at,
            "episodes": [
                {
                    "episode_number": item.episode_number,
                    "chapter_ordinals": item.chapter_ordinals,
                    "target": item.target,
                    "conflict": item.conflict,
                    "turn": item.turn,
                    "ending_hook": item.ending_hook,
                    "preserve_facts": item.preserve_facts,
                    "allowed_changes": item.allowed_changes,
                    "adaptation_note": item.adaptation_note,
                }
                for item in mappings_by_branch.get(branch.id, [])
            ],
        }
        for branch in branches
    ]


@router.get("/projects/{project_id}/adaptation-outlines")
def list_adaptation_outlines(project_id: str, db: Session = Depends(get_db)):
    project_or_404(db, project_id)
    outline_stage = db.scalar(
        select(StageState).where(
            StageState.project_id == project_id,
            StageState.stage_key == "outline",
        )
    )
    current_outline_id = (
        (outline_stage.decision or {}).get("outline_release_id")
        if outline_stage and outline_stage.status == "accepted"
        else None
    )
    branch_ids = db.scalars(
        select(AdaptationBranch.id).where(AdaptationBranch.project_id == project_id)
    ).all()
    releases = (
        db.scalars(
            select(AdaptationOutlineRelease)
            .where(AdaptationOutlineRelease.branch_id.in_(branch_ids))
            .order_by(AdaptationOutlineRelease.created_at.desc())
        ).all()
        if branch_ids
        else []
    )
    episode_rows = (
        db.scalars(
            select(EpisodeAdaptationOutline)
            .where(EpisodeAdaptationOutline.outline_release_id.in_([item.id for item in releases]))
            .order_by(EpisodeAdaptationOutline.episode_number)
        ).all()
        if releases
        else []
    )
    episodes_by_release: dict[str, list[EpisodeAdaptationOutline]] = {}
    for episode in episode_rows:
        episodes_by_release.setdefault(episode.outline_release_id, []).append(episode)
    return [
        {
            "id": release.id,
            "branch_id": release.branch_id,
            "revision": release.revision,
            "job_id": release.job_id,
            "episode_count": release.episode_count,
            "creative_thesis": release.creative_thesis,
            "is_current": release.id == current_outline_id,
            "created_at": release.created_at,
            "episodes": [
                {
                    "episode_number": episode.episode_number,
                    "source_chapter_ordinals": episode.source_chapter_ordinals,
                    "adaptation_summary": episode.adaptation_summary,
                    "emotional_arc": episode.emotional_arc,
                    "ending_hook": episode.ending_hook,
                    "scenes": episode.scenes,
                }
                for episode in episodes_by_release.get(release.id, [])
            ],
        }
        for release in releases
    ]
