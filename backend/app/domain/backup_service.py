from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

from app.core.backup_lock import acquire_restore_lock
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.settings import BACKEND_DIR, get_settings

BACKUP_FORMAT_VERSION = 1
ARCHIVE_CHUNK_SIZE = 64 * 1024
REQUIRED_SNAPSHOT_TABLES = {
    "admin_settings",
    "ai_analyses",
    "ai_analysis_versions",
    "article_comments",
    "article_tags",
    "articles",
    "categories",
    "media_assets",
    "model_api_configs",
    "prompt_configs",
    "tags",
}
SNAPSHOT_DATA_TABLES = REQUIRED_SNAPSHOT_TABLES | {"alembic_version"}
EXCLUDED_RUNTIME_TABLES = (
    "ai_tasks",
    "ai_task_events",
    "ai_usage_logs",
    "article_embeddings",
)


class BackupService:
    def __init__(
        self,
        database_url: str | None = None,
        media_root: str | None = None,
        current_schema_version: str | None = None,
        source_commit: str | None = None,
    ) -> None:
        settings = get_settings()
        self.database_url = database_url or settings.database_url
        self.media_root = Path(media_root or settings.media.root)
        self.current_schema_version = (
            current_schema_version or self._detect_current_schema_version()
        )
        self.source_commit = source_commit or self._detect_source_commit()

    def export_backup_stream(self, db: Session) -> Iterable[bytes]:
        source_db_path = self._resolve_database_path(db)

        def _stream() -> Iterable[bytes]:
            with tempfile.TemporaryDirectory(prefix="lumina-backup-export-") as temp_dir:
                temp_path = Path(temp_dir)
                snapshot_path = temp_path / "snapshot.db"
                archive_path = temp_path / "lumina-backup.zip"
                manifest_path = temp_path / "manifest.json"

                self._create_filtered_snapshot(source_db_path, snapshot_path)
                manifest = self._build_manifest(source_db_path)
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                self._build_archive(
                    archive_path=archive_path,
                    snapshot_path=snapshot_path,
                    manifest_path=manifest_path,
                )

                with archive_path.open("rb") as archive_file:
                    while True:
                        chunk = archive_file.read(ARCHIVE_CHUNK_SIZE)
                        if not chunk:
                            break
                        yield chunk

        return _stream()

    def import_backup(self, db: Session, archive_input: BinaryIO | bytes) -> dict[str, Any]:
        with acquire_restore_lock(self.database_url):
            engine = db.get_bind()
            db.close()
            if isinstance(engine, Engine):
                engine.dispose()

            target_db_path = self._resolve_database_path(None)

            with tempfile.TemporaryDirectory(prefix="lumina-backup-import-") as temp_dir:
                temp_path = Path(temp_dir)
                extracted_dir = temp_path / "extracted"
                rollback_dir = temp_path / "rollback"
                extracted_dir.mkdir(parents=True, exist_ok=True)
                rollback_dir.mkdir(parents=True, exist_ok=True)

                self._extract_archive(archive_input, extracted_dir)
                manifest = self._load_manifest(extracted_dir / "manifest.json")
                snapshot_path = extracted_dir / "snapshot.db"
                if not snapshot_path.exists():
                    raise ValueError("导入失败：缺少 snapshot.db")

                self._validate_manifest(manifest)
                self._validate_snapshot(snapshot_path)

                rollback_state = self._create_rollback(target_db_path, rollback_dir)

                try:
                    self._restore_database_file(snapshot_path, target_db_path)
                    self._restore_media_directory(extracted_dir / "media", self.media_root)
                except Exception:
                    self._restore_rollback(target_db_path, rollback_state)
                    raise

                return {
                    "success": True,
                    "meta": {
                        "backup_exported_at": manifest["exported_at"],
                        "backup_format_version": int(manifest["format_version"]),
                        "backup_source_schema_version": manifest["source_schema_version"],
                        "restored_at": datetime.now(timezone.utc).isoformat(),
                    },
                    "restored": {
                        "includes": {
                            "comments": bool(manifest["includes"]["comments"]),
                            "media": bool(manifest["includes"]["media"]),
                            "secrets": bool(manifest["includes"]["secrets"]),
                        }
                    }
                }

    def _build_manifest(self, source_db_path: Path) -> dict[str, Any]:
        return {
            "format_version": BACKUP_FORMAT_VERSION,
            "app": "lumina",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "source_schema_version": self._read_database_schema_version(source_db_path)
            or self.current_schema_version,
            "source_commit": self.source_commit,
            "includes": {
                "comments": True,
                "media": True,
                "secrets": True,
            },
        }

    def _build_archive(
        self,
        *,
        archive_path: Path,
        snapshot_path: Path,
        manifest_path: Path,
    ) -> None:
        with zipfile.ZipFile(
            archive_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            archive.write(manifest_path, arcname="manifest.json")
            archive.write(snapshot_path, arcname="snapshot.db")
            if self.media_root.exists():
                for path in sorted(self.media_root.rglob("*")):
                    if not path.is_file():
                        continue
                    relative = path.relative_to(self.media_root).as_posix()
                    archive.write(path, arcname=f"media/{relative}")

    def _create_filtered_snapshot(self, source_db_path: Path, snapshot_path: Path) -> None:
        source = sqlite3.connect(str(source_db_path))
        destination = sqlite3.connect(str(snapshot_path))
        try:
            source.backup(destination)
            destination.execute("PRAGMA foreign_keys=OFF")
            destination.execute("UPDATE articles SET view_count = 0")
            for table_name in EXCLUDED_RUNTIME_TABLES:
                if self._table_exists(destination, table_name):
                    destination.execute(f'DELETE FROM "{table_name}"')
            extra_tables = self._list_snapshot_tables(destination) - SNAPSHOT_DATA_TABLES
            for table_name in sorted(extra_tables):
                destination.execute(f'DELETE FROM "{table_name}"')
            destination.commit()
        finally:
            destination.close()
            source.close()

    def _extract_archive(self, archive_input: BinaryIO | bytes, extracted_dir: Path) -> None:
        archive_path = extracted_dir.parent / "uploaded-backup.zip"
        if isinstance(archive_input, bytes):
            archive_path.write_bytes(archive_input)
        else:
            with archive_path.open("wb") as archive_file:
                while True:
                    chunk = archive_input.read(ARCHIVE_CHUNK_SIZE)
                    if not chunk:
                        break
                    archive_file.write(chunk)
        if not archive_path.exists() or archive_path.stat().st_size <= 0:
            raise ValueError("导入失败：备份文件读取失败")
        try:
            with zipfile.ZipFile(archive_path) as archive:
                archive.extractall(extracted_dir)
        except zipfile.BadZipFile as exc:
            raise ValueError("导入失败：备份文件不是有效的 zip") from exc

    def _load_manifest(self, manifest_path: Path) -> dict[str, Any]:
        if not manifest_path.exists():
            raise ValueError("导入失败：缺少 manifest.json")
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("导入失败：manifest.json 格式不正确") from exc
        if not isinstance(raw, dict):
            raise ValueError("导入失败：manifest.json 格式不正确")
        return raw

    def _validate_manifest(self, manifest: dict[str, Any]) -> None:
        format_version = int(manifest.get("format_version") or 0)
        if format_version != BACKUP_FORMAT_VERSION:
            raise ValueError(
                f"导入失败：仅支持 format_version={BACKUP_FORMAT_VERSION}，当前为 {format_version}"
            )

        source_schema_version = str(manifest.get("source_schema_version") or "").strip()
        if (
            source_schema_version
            and self.current_schema_version
            and source_schema_version > self.current_schema_version
        ):
            raise ValueError(
                f"导入失败：备份来自更高版本 {source_schema_version}，当前仅支持恢复到 {self.current_schema_version}"
            )

        includes = manifest.get("includes")
        if not isinstance(includes, dict):
            raise ValueError("导入失败：manifest.json includes 字段缺失")

    def _validate_snapshot(self, snapshot_path: Path) -> None:
        connection = sqlite3.connect(str(snapshot_path))
        try:
            existing_tables = self._list_snapshot_tables(connection)
        finally:
            connection.close()

        missing_tables = REQUIRED_SNAPSHOT_TABLES - existing_tables
        if missing_tables:
            missing = ", ".join(sorted(missing_tables))
            raise ValueError(f"导入失败：快照数据库缺少必要表：{missing}")

    def _create_rollback(self, database_path: Path, rollback_dir: Path) -> dict[str, Any]:
        database_backup = rollback_dir / "database"
        media_backup = rollback_dir / "media"
        database_backup.mkdir(parents=True, exist_ok=True)

        rollback_state: dict[str, Any] = {
            "db_exists": database_path.exists(),
            "db_backup": {},
            "media_exists": self.media_root.exists(),
            "media_backup": media_backup,
        }

        for suffix in ("", "-wal", "-shm"):
            original = Path(f"{database_path}{suffix}")
            backup = database_backup / original.name
            if original.exists():
                shutil.copy2(original, backup)
                rollback_state["db_backup"][suffix] = backup

        if self.media_root.exists():
            shutil.copytree(self.media_root, media_backup, dirs_exist_ok=True)

        return rollback_state

    def _restore_database_file(self, snapshot_path: Path, database_path: Path) -> None:
        database_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snapshot_path, database_path)
        for suffix in ("-wal", "-shm"):
            transient = Path(f"{database_path}{suffix}")
            if transient.exists():
                transient.unlink()

    def _restore_media_directory(self, archive_media_root: Path, target_media_root: Path) -> None:
        if target_media_root.exists():
            shutil.rmtree(target_media_root)
        if archive_media_root.exists():
            shutil.copytree(archive_media_root, target_media_root)
        else:
            target_media_root.mkdir(parents=True, exist_ok=True)

    def _restore_rollback(self, database_path: Path, rollback_state: dict[str, Any]) -> None:
        for suffix in ("", "-wal", "-shm"):
            target = Path(f"{database_path}{suffix}")
            if target.exists():
                target.unlink()

        db_backup = rollback_state.get("db_backup") or {}
        for suffix, backup_path in db_backup.items():
            shutil.copy2(Path(backup_path), Path(f"{database_path}{suffix}"))

        if self.media_root.exists():
            shutil.rmtree(self.media_root)

        media_backup = Path(rollback_state["media_backup"])
        if rollback_state.get("media_exists") and media_backup.exists():
            shutil.copytree(media_backup, self.media_root)

    def _resolve_database_path(self, db: Session | None) -> Path:
        database_url = self.database_url
        if db is not None:
            bind = db.get_bind()
            url = getattr(bind, "url", None)
            if url is not None:
                database_url = str(url)

        if not database_url.startswith("sqlite:///"):
            raise ValueError("仅支持 SQLite 镜像备份")

        database_path = database_url.removeprefix("sqlite:///")
        path = Path(database_path)
        return path if path.is_absolute() else (Path.cwd() / path).resolve()

    def _read_database_schema_version(self, database_path: Path) -> str:
        connection = sqlite3.connect(str(database_path))
        try:
            row = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alembic_version'"
            ).fetchone()
            if not row:
                return ""
            version_row = connection.execute(
                "SELECT version_num FROM alembic_version LIMIT 1"
            ).fetchone()
            return str(version_row[0]) if version_row and version_row[0] else ""
        finally:
            connection.close()

    def _list_snapshot_tables(self, connection: sqlite3.Connection) -> set[str]:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        return {str(row[0]) for row in rows}

    def _table_exists(self, connection: sqlite3.Connection, table_name: str) -> bool:
        row = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        return bool(row)

    def _detect_current_schema_version(self) -> str:
        versions_dir = BACKEND_DIR / "alembic" / "versions"
        version_files = sorted(path.stem for path in versions_dir.glob("*.py"))
        return version_files[-1] if version_files else ""

    def _detect_source_commit(self) -> str:
        try:
            output = subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=BACKEND_DIR.parent,
                stderr=subprocess.DEVNULL,
                text=True,
            )
        except Exception:
            return "unknown"
        return output.strip() or "unknown"
