from fastapi import APIRouter, Depends, HTTPException, Request, Response

from lib.core import uid, now_iso, audit, clean
from lib.db import db
from lib.security import (COOKIE, create_session, current_user, hash_password, permissions_for, rate_limit, require, verify_password)
from models.schemas import LoginIn, Me, User, UserIn
import os

router = APIRouter()


@router.post("/auth/login", response_model=Me)
async def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "-"
    rate_limit(f"login:{ip}", 10)
    user = await db.users.find_one({"email": body.email.lower().strip(), "active": True})
    if not user or not verify_password(body.password, user["password_hash"]):
        await audit({"email": body.email, "role": "-"}, "LOGIN_FAILED", "user", "", "Email/password salah", ip)
        raise HTTPException(401, "Email atau password salah")
    token, max_age = await create_session(user)
    response.set_cookie(COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=os.environ.get("COOKIE_SECURE", "true") == "true", path="/")
    await audit(user, "LOGIN", "user", user["id"], "", ip)
    clean(user)
    user.pop("password_hash", None)
    return {**user, "permissions": permissions_for(user["role"])}


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    try:
        user = await current_user(request)
        await db.sessions.delete_one({"id": user["sid"]})
        await audit(user, "LOGOUT", "user", user["id"])
    except HTTPException:
        pass
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me", response_model=Me)
async def me(user: dict = Depends(current_user)):
    return {**user, "permissions": permissions_for(user["role"])}


@router.get("/users", response_model=list[User])
async def list_users(_: dict = Depends(require("users.manage"))):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(500)


@router.post("/users", response_model=User)
async def create_user(body: UserIn, actor: dict = Depends(require("users.manage"))):
    if not body.password:
        raise HTTPException(422, "Password wajib diisi (min 8 karakter)")
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(409, "Email sudah digunakan")
    doc = {**body.model_dump(exclude={"password"}), "email": body.email.lower(), "id": uid(),
           "password_hash": hash_password(body.password), "created_at": now_iso()}
    await db.users.insert_one(doc)
    await audit(actor, "TAMBAH_USER", "user", doc["id"], f"{doc['email']} ({doc['role']})")
    return clean(doc)


@router.put("/users/{id}", response_model=User)
async def update_user(id: str, body: UserIn, actor: dict = Depends(require("users.manage"))):
    patch = body.model_dump(exclude={"password"})
    patch["email"] = body.email.lower()
    if body.password:
        patch["password_hash"] = hash_password(body.password)
    res = await db.users.find_one_and_update({"id": id}, {"$set": patch}, projection={"_id": 0, "password_hash": 0}, return_document=True)
    if not res:
        raise HTTPException(404, "User tidak ditemukan")
    if not body.active:
        await db.sessions.delete_many({"user_id": id})
    await audit(actor, "EDIT_USER", "user", id, patch["email"])
    return res
