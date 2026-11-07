"""ASGI entry point: ``uv run uvicorn app.main:app --reload``."""

from .api.app import app

__all__ = ["app"]
