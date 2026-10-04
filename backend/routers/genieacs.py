from fastapi import APIRouter, Depends, HTTPException

from integrations.genieacs.base import AcsError
from integrations.genieacs.service import GenieAcsService
from lib.security import require
from models.genieacs import AcsActionResult, AcsConfig, AcsConfigIn, AcsDevice, AcsLinkIn, AcsTestResult, AcsWifiIn

router = APIRouter()


def _err(e: AcsError) -> HTTPException:
    code = {"GENIEACS_DEVICE_NOT_FOUND": 404, "GENIEACS_DISABLED": 409, "GENIEACS_TASK_FAILED": 502}.get(e.code, 503)
    return HTTPException(code, {"code": e.code, "message": e.message})


@router.get("/genieacs/config", response_model=AcsConfig)
async def get_config(_: dict = Depends(require("mikrotik.view"))):
    return await GenieAcsService.config_out()


@router.put("/genieacs/config", response_model=AcsConfig)
async def put_config(body: AcsConfigIn, actor: dict = Depends(require("settings.manage"))):
    return await GenieAcsService.save_config(body.model_dump(), actor)


@router.post("/genieacs/test", response_model=AcsTestResult)
async def test(actor: dict = Depends(require("mikrotik.routers"))):
    return await GenieAcsService.test(actor)


@router.get("/genieacs/devices", response_model=list[AcsDevice])
async def devices(q: str = "", status: str = "", customer_id: str = "", _: dict = Depends(require("mikrotik.view"))):
    try:
        return await GenieAcsService.devices(q, status, customer_id)
    except AcsError as e:
        raise _err(e)


async def _act(device_id: str, action: str, actor: dict, **kw) -> dict:
    try:
        return await GenieAcsService.action(device_id, action, actor, **kw)
    except AcsError as e:
        raise _err(e)


@router.post("/genieacs/devices/{device_id}/wifi", response_model=AcsActionResult)
async def wifi(device_id: str, body: AcsWifiIn, actor: dict = Depends(require("mikrotik.control"))):
    return await _act(device_id, "wifi", actor, ssid=body.ssid, password=body.password)


@router.post("/genieacs/devices/{device_id}/reboot", response_model=AcsActionResult)
async def reboot(device_id: str, actor: dict = Depends(require("mikrotik.control"))):
    return await _act(device_id, "reboot", actor)


@router.post("/genieacs/devices/{device_id}/refresh", response_model=AcsActionResult)
async def refresh(device_id: str, actor: dict = Depends(require("mikrotik.control"))):
    return await _act(device_id, "refresh", actor)


@router.put("/genieacs/devices/{device_id}/link")
async def link(device_id: str, body: AcsLinkIn, actor: dict = Depends(require("mikrotik.control"))):
    try:
        await GenieAcsService.link(device_id, body.customer_id, actor)
    except AcsError as e:
        raise HTTPException(422, e.message)
    return {"ok": True}
