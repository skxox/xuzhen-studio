from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./var/xuzhen.db"
    storage_dir: Path = Path("./var/assets")
    max_upload_mb: int = 40
    model_config = SettingsConfigDict(env_prefix="XZ_", env_file=".env", extra="ignore")


settings = Settings()
