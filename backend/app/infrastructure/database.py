from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from ..core.config import settings


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# D-01a 为 projects 表新增的维度列。create_all 只建缺失的表、不改既有表，
# 因此启动时做最小列补齐，保证旧开发库可继续使用；
# D-02a 建立 Alembic 迁移基线后由迁移接管并移除本机制。
PROJECT_DIMENSION_COLUMNS = ("source_kind", "content_mode", "video_mode")


def ensure_project_dimension_columns() -> None:
    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return
    existing = {column["name"] for column in inspector.get_columns("projects")}
    with engine.begin() as connection:
        for name in PROJECT_DIMENSION_COLUMNS:
            if name not in existing:
                connection.execute(text(f"ALTER TABLE projects ADD COLUMN {name} VARCHAR(32)"))
