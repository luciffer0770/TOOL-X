"""Application settings and environment configuration."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed runtime settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="PSETW_", extra="ignore")

    app_name: str = "PS-ETW Python Platform"
    env: Literal["dev", "test", "prod"] = "dev"
    log_level: str = "INFO"
    api_host: str = "127.0.0.1"
    api_port: int = 8000

    database_url: str = "sqlite:///./psetw_platform.db"
    secret_key: SecretStr = Field(default=SecretStr("change-me"))
    access_token_expire_minutes: int = 60
    seed_demo_users: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached settings instance."""

    return Settings()
