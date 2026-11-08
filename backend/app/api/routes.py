from fastapi import APIRouter

from .chapters import router as chapters_router
from .creative import router as creative_router
from .jobs import router as jobs_router
from .projects import router as projects_router
from .providers import router as providers_router
from .workflow import router as workflow_router

router = APIRouter()
router.include_router(projects_router)
router.include_router(chapters_router)
router.include_router(creative_router)
router.include_router(workflow_router)
router.include_router(providers_router)
router.include_router(jobs_router)
