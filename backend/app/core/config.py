from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./var/xuzhen.db"
    storage_dir: Path = Path("./var/assets")
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    max_upload_mb: int = 40
    provider_secrets: dict[str, str] = Field(default_factory=dict, repr=False)
    allow_private_provider_endpoints: bool = False
    model_config = SettingsConfigDict(env_prefix="XZ_", env_file=".env", extra="ignore")


settings = Settings()
