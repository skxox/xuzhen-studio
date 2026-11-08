from sqlalchemy import select
from sqlalchemy.orm import Session

from ..domain.models import (
    AdaptationBranch,
    AdaptationOutlineRelease,
    EpisodeAdaptationOutline,
    EpisodeSourceMapping,
    Project,
    ScriptRelease,
    ShotPlanRelease,
    StageState,
)
from ..services.adaptation_decisions import AdaptationDecisions
from ..services.adaptation_mapping import current_adaptation_branch
from ..services.audit import audit


def materialize_adaptation_release(
    db: Session,
    project: Project,
    project_id: str,
    stage: StageState,
    stage_key: str,
    *,
    action: str,
    decisions: AdaptationDecisions,
) -> bool:
    mapping = decisions.mapping
    if stage_key == "source" and action == "accept" and mapping:
        previous_branch = db.scalar(
            select(AdaptationBranch)
            .where(AdaptationBranch.project_id == project_id)
            .order_by(AdaptationBranch.revision.desc())
            .limit(1)
        )
        branch = AdaptationBranch(
            project_id=project_id,
            release_id=mapping["release_id"],
            revision=(previous_branch.revision + 1) if previous_branch else 1,
            episode_count=mapping["episode_count"],
            episode_seconds=mapping["episode_seconds"],
            aspect_ratio=mapping["aspect_ratio"],
            previous_branch_id=previous_branch.id if previous_branch else None,
        )
        db.add(branch)
        db.flush()
        for episode in mapping["episodes"]:
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
            "candidate_job_id": mapping["candidate_job_id"],
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
            {**stage.decision, "mapping_count": len(mapping["episodes"])},
        )
        return True

    outline_decision = decisions.outline
    if stage_key == "outline" and action == "accept" and outline_decision:
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
        return True

    script_decision = decisions.script
    if stage_key == "script" and action == "accept" and script_decision:
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
        return True

    shot_plan_decision = decisions.shot_plan
    if stage_key == "shotDesign" and action == "accept" and shot_plan_decision:
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
        return True

    return False
