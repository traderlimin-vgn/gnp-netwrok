"""Auth (bcrypt + JWT httpOnly cookie sessions), RBAC, credential encryption, rate limiting."""

import base64
import hashlib
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request

from lib.core import uid, now_iso
from lib.db import db

SECRET = os.environ["APP_SECRET"]
COOKIE = "gmp_session"
SESSION_HOURS = 12
_FERNET = Fernet(base64.urlsafe_b64encode(hashlib.sha256(os.environ["CREDENTIAL_ENCRYPTION_KEY"].encode()).digest()))

ROLES = ["super_admin", "admin", "finance", "cs", "teknisi", "supervisor"]
ALL = set(ROLES)
PERMISSIONS: dict[str, set[str]] = {
    "dashboard.view": ALL,
    "customers.view": ALL,
    "customers.write": {"super_admin", "admin", "cs"},
    "customers.delete": {"super_admin", "admin"},
    "packages.write": {"super_admin", "admin"},
    "billing.view": {"super_admin", "admin", "finance", "cs", "supervisor"},
    "billing.write": {"super_admin", "admin", "finance"},
    "payments.write": {"super_admin", "admin", "finance"},
    "mikrotik.view": {"super_admin", "admin", "supervisor", "teknisi"},
    "mikrotik.control": {"super_admin", "admin"},
    "mikrotik.routers": {"super_admin", "admin"},
    "tickets.view": ALL - {"finance"},
    "tickets.write": {"super_admin", "admin", "cs", "teknisi"},
    "psb.view": ALL - {"finance"},
    "psb.write": {"super_admin", "admin", "cs"},
    "map.view": ALL,
    "reports.view": {"super_admin", "admin", "finance", "supervisor"},
    "audit.view": {"super_admin", "admin", "supervisor"},
    "settings.manage": {"super_admin"},
    "users.manage": {"super_admin"},
    "whatsapp.send": {"super_admin", "admin", "finance", "cs"},
    "technician.view": {"teknisi", "super_admin", "admin", "supervisor"},
}


def permissions_for(role: str) -> list[str]:
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(12)).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def encrypt_secret(plain: str) -> str:
    return _FERNET.encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _FERNET.decrypt(token.encode()).decode()
    except (InvalidToken, AttributeError):
        return ""


async def create_session(user: dict) -> tuple[str, int]:
    sid = uid()
    exp = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    await db.sessions.insert_one({"id": sid, "user_id": user["id"], "created_at": now_iso(), "expires_at": exp})
    token = jwt.encode({"sid": sid, "sub": user["id"], "exp": exp}, SECRET, algorithm="HS256")
    return token, SESSION_HOURS * 3600


async def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Belum login")
    try:
        payload = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesi tidak valid atau kedaluwarsa")
    if not await db.sessions.find_one({"id": payload["sid"]}):
        raise HTTPException(401, "Sesi sudah berakhir")
    user = await db.users.find_one({"id": payload["sub"], "active": True}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Pengguna tidak aktif")
    user["sid"] = payload["sid"]
    return user


def require(perm: str):
    async def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in PERMISSIONS[perm]:
            raise HTTPException(403, "Anda tidak memiliki akses untuk aksi ini")
        return user
    return dep


_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window: int = 60) -> None:
    q = _hits[key]
    t = time.time()
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Terlalu banyak percobaan, coba lagi sebentar lagi")
    q.append(t)
