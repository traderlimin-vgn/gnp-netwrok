import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from lib.db import client, db, ensure_indexes  # noqa: E402
from lib.jobs import start_workers  # noqa: E402
from lib.settings import get_settings  # noqa: E402
from routers import auth, customers, billing as billing_router, mikrotik, ops, insights, genieacs, network, topology  # noqa: E402
from services import billing  # noqa: E402
from integrations.mikrotik.services import MikroTikBillingService  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


async def scheduler():
    """Periodic automation: overdue/isolation, pending MikroTik retry, router health, auto-sync, daily backup."""
    tick = 0
    await asyncio.sleep(5)
    while True:
        try:
            s = await get_settings()
            await billing.run_automation("system")
            await MikroTikBillingService.retry_pending()
            if tick % max(1, s["polling_interval"] // 30) == 0:
                await billing.health_poll_all()
            if s["auto_sync"] and tick % 10 == 0:
                from lib.jobs import enqueue
                for r in await db.mikrotik_routers.find({"status": "online"}, {"_id": 0, "id": 1}).to_list(200):
                    await enqueue("sync_router", {"router_id": r["id"], "actor": "system"})
            await insights.auto_backup_if_due()
            try:
                from services.network_faults import analyze
                await analyze()  # records cable-fault history even when nobody has the map open
            except Exception:
                logger.warning("fault analysis skipped (GenieACS unavailable)")
        except Exception:
            logger.exception("scheduler tick failed")
        tick += 1
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())
    app.state.workers = await start_workers(2)
    app.state.scheduler = asyncio.create_task(scheduler())
    yield
    app.state.scheduler.cancel()
    for w in app.state.workers:
        w.cancel()
    client.close()


app = FastAPI(title="NETWORK GMP Billing API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "NETWORK GMP API"}


SAFE = {"GET", "HEAD", "OPTIONS"}
CSRF_EXEMPT = {"/api/auth/login"}


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # CSRF: state-changing requests must carry the custom header (cannot be set cross-site without CORS preflight)
    if request.method not in SAFE and request.url.path.startswith("/api") and request.url.path not in CSRF_EXEMPT:
        if request.headers.get("x-requested-with") != "gmp":
            return JSONResponse({"detail": "CSRF check failed"}, status_code=403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp


for r in (auth.router, customers.router, billing_router.router, mikrotik.router, ops.router, insights.router, genieacs.router, network.router, topology.router):
    api_router.include_router(r)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the router in the main app — must stay last
app.include_router(api_router)
