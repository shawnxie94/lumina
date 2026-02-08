"""
认证模块 - 管理员登录和权限验证
"""

import secrets
import hashlib
from datetime import datetime, timedelta
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from passlib.context import CryptContext

from models import get_db, AdminSettings, now_str

# JWT 配置
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 天有效期

# HTTP Bearer 认证
security = HTTPBearer(auto_error=False)


# ============ Pydantic Schemas ============


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    message: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class SetupRequest(BaseModel):
    password: str


# ============ 密码工具函数 ============


PASSWORD_HASH_VERSION_SHA256 = "sha256$"
PASSWORD_HASH_VERSION_BCRYPT = "bcrypt$"
MAX_BCRYPT_PASSWORD_BYTES = 72
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _hash_password_sha256(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def hash_password(password: str) -> str:
    """使用 bcrypt 哈希密码"""
    if len(password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        raise ValueError("密码过长（最长72字节），请缩短后重试")
    return f"{PASSWORD_HASH_VERSION_BCRYPT}{pwd_context.hash(password)}"


def verify_password(password: str, password_hash: str) -> tuple[bool, bool]:
    """验证密码。返回 (是否匹配, 是否需要升级哈希)"""
    if not password_hash:
        return False, False

    if password_hash.startswith(PASSWORD_HASH_VERSION_BCRYPT):
        hashed = password_hash[len(PASSWORD_HASH_VERSION_BCRYPT) :]
        if len(password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
            return False, False
        try:
            return pwd_context.verify(password, hashed), False
        except Exception:
            return False, False

    if password_hash.startswith(PASSWORD_HASH_VERSION_SHA256):
        hashed = password_hash[len(PASSWORD_HASH_VERSION_SHA256) :]
        return _hash_password_sha256(password) == hashed, True

    if len(password_hash) == 64:
        return _hash_password_sha256(password) == password_hash, True

    return False, False


def generate_jwt_secret() -> str:
    """生成随机 JWT 密钥"""
    return secrets.token_hex(32)


# ============ JWT 工具函数 ============


def create_token(jwt_secret: str) -> str:
    """创建 JWT token"""
    payload = {
        "sub": "admin",
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
    }
    return jwt.encode(payload, jwt_secret, algorithm=JWT_ALGORITHM)


def verify_token(token: str, jwt_secret: str) -> bool:
    """验证 JWT token"""
    try:
        jwt.decode(token, jwt_secret, algorithms=[JWT_ALGORITHM])
        return True
    except jwt.ExpiredSignatureError:
        return False
    except jwt.InvalidTokenError:
        return False


# ============ 数据库操作 ============


def get_admin_settings(db: Session) -> Optional[AdminSettings]:
    """获取管理员设置"""
    return db.query(AdminSettings).first()


def create_admin_settings(db: Session, password: str) -> AdminSettings:
    """创建管理员设置（首次设置密码）"""
    admin = AdminSettings(
        password_hash=hash_password(password),
        jwt_secret=generate_jwt_secret(),
        comments_enabled=True,
        nextauth_secret=secrets.token_hex(32),
        sensitive_filter_enabled=True,
        sensitive_words="",
        media_storage_enabled=False,
        media_compress_threshold=1536 * 1024,
        media_max_dim=2000,
        media_webp_quality=80,
        recommendations_enabled=False,
        recommendation_model_config_id=None,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def update_admin_password(db: Session, admin: AdminSettings, new_password: str) -> None:
    """更新管理员密码"""
    admin.password_hash = hash_password(new_password)
    admin.jwt_secret = (
        generate_jwt_secret()
    )  # 更换密码时重新生成 JWT 密钥，使旧 token 失效
    admin.updated_at = now_str()
    db.commit()


# ============ FastAPI 依赖 ============


def get_current_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> bool:
    """
    验证当前请求是否来自已登录的管理员
    用于保护需要管理员权限的路由
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录，请先登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="系统未初始化，请先设置管理员密码",
        )

    if not verify_token(credentials.credentials, admin.jwt_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True


def check_is_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> bool:
    """
    检查当前请求是否来自已登录的管理员（不抛出异常）
    用于前端判断是否显示管理功能
    """
    if credentials is None:
        return False

    admin = get_admin_settings(db)
    if admin is None:
        return False

    return verify_token(credentials.credentials, admin.jwt_secret)
