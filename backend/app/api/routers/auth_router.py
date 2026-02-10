from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    SetupRequest,
    check_is_admin,
    create_admin_settings,
    create_token,
    get_admin_settings,
    get_current_admin,
    update_admin_password,
    verify_password,
)
from models import get_db

router = APIRouter()


@router.get("/api/auth/status")
async def get_auth_status(db: Session = Depends(get_db)):
    """获取认证状态：是否已初始化管理员密码"""
    admin = get_admin_settings(db)
    return {"initialized": admin is not None}


@router.post("/api/auth/setup")
async def setup_admin(request: SetupRequest, db: Session = Depends(get_db)):
    """首次设置管理员密码"""
    admin = get_admin_settings(db)
    if admin is not None:
        raise HTTPException(status_code=400, detail="管理员密码已设置")

    try:
        admin = create_admin_settings(db, request.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="管理员密码设置成功")


@router.post("/api/auth/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    """管理员登录"""
    admin = get_admin_settings(db)
    if admin is None:
        raise HTTPException(status_code=400, detail="系统未初始化，请先设置管理员密码")

    is_valid, needs_upgrade = verify_password(request.password, admin.password_hash)
    if not is_valid:
        raise HTTPException(status_code=401, detail="密码错误")

    if needs_upgrade:
        update_admin_password(db, admin, request.password)

    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="登录成功")


@router.get("/api/auth/verify")
async def verify_auth(is_admin: bool = Depends(check_is_admin)):
    """验证当前 token 是否有效"""
    return {"valid": is_admin, "role": "admin" if is_admin else "guest"}


@router.put("/api/auth/password")
async def change_password(
    request: ChangePasswordRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_current_admin),
):
    """修改管理员密码（需要登录）"""
    admin = get_admin_settings(db)

    is_valid, _ = verify_password(request.old_password, admin.password_hash)
    if not is_valid:
        raise HTTPException(status_code=401, detail="原密码错误")

    try:
        update_admin_password(db, admin, request.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    token = create_token(admin.jwt_secret)
    return LoginResponse(token=token, message="密码修改成功，请使用新 token")
