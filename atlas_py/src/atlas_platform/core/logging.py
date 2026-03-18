"""Logging bootstrap utilities."""

from __future__ import annotations

import logging


def configure_logging(log_level: str) -> None:
    """Configure root logging with a consistent enterprise format."""

    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
