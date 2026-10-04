from fastapi import APIRouter, Depends, HTTPException

from integrations.genieacs.base import AcsError
from integrations.genieacs.service import GenieAcsService
from integrations.genieacs.simulator import GenieAcsSimulator
from lib.core import audit
from lib.db import db
from lib.security import require
from models.network import FaultReport, SimulateCutIn
from services.network_faults import analyze

router = APIRouter()


@router.get("/network/faults", response_model=FaultReport)
async def faults(_: dict = Depends(require("map.view"))):
    try:
        return await analyze()
    except AcsError as e:
        raise HTTPException(503, {"code": e.code, "message": e.message})


@router.post("/network/faults/simulate")
async def simulate(body: SimulateCutIn, actor: dict = Depends(require("mikrotik.control"))):
    if (await GenieAcsService.raw_config())["mode"] != "simulator":
        raise HTTPException(409, "Simulasi putus kabel hanya tersedia di mode Simulator GenieACS")
    odp = await db.map_assets.find_one({"id": body.odp_id, "type": "odp"})
    if not odp:
        raise HTTPException(404, "ODP tidak ditemukan")
    users = [c["pppoe_username"] for c in await db.customers.find({"odp_id": body.odp_id, "pppoe_username": {"$ne": ""}}, {"pppoe_username": 1}).to_list(1000)]
    n = await GenieAcsSimulator.set_cut(users, body.cut)
    await audit(actor, "SIMULASI_PUTUS_KABEL" if body.cut else "SIMULASI_PULIH_KABEL", "odp", body.odp_id, f"{odp['name']} · {n} ONT")
    return {"odp_name": odp["name"], "onts": n, "cut": body.cut}
