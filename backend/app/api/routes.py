from fastapi import APIRouter

from .branches import router as branches_router
from .chapters import router as chapters_router
from .creative import router as creative_router
from .delivery import router as delivery_router
from .job_queries import router as job_queries_router
from .jobs import router as jobs_router
from .post import router as post_router
from .projects import router as projects_router
from .providers import router as providers_router
from .releases import router as releases_router
from .scripts import router as scripts_router
from .stage_lifecycle import router as stage_lifecycle_router
from .storyboards import router as storyboards_router
from .video_jobs import router as video_jobs_router
from .workflow import router as workflow_router

router = APIRouter()
router.include_router(projects_router)
router.include_router(chapters_router)
router.include_router(branches_router)
router.include_router(creative_router)
router.include_router(workflow_router)
router.include_router(providers_router)
router.include_router(releases_router)
router.include_router(scripts_router)
router.include_router(storyboards_router)
router.include_router(stage_lifecycle_router)
router.include_router(post_router)
router.include_router(delivery_router)
router.include_router(jobs_router)
router.include_router(job_queries_router)
router.include_router(video_jobs_router)
