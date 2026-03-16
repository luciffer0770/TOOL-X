"""ATLAS Planner - Configuration"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ATLAS_DB_PATH", str(BASE_DIR / "atlas_data.db")))
