"""ATLAS Planner - Configuration (shared with app.py)"""
import os
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = _PKG_DIR.parent
BASE_DIR = WORKSPACE_ROOT
DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(WORKSPACE_ROOT / "atlas_data.db")))
