"""Epoch web app (FastAPI + Jinja2 + HTMX)."""
from __future__ import annotations

from .app import create_app

__all__ = ["create_app"]
