"""Pre-scaffolded pytest fixtures for the FastAPI backend.

Tests hit the live uvicorn process managed by supervisor (not an in-process ASGI app), so
the app under test is the same one the frontend and Playwright see. Do NOT re-create this
file — add app-specific fixtures below the marker at the bottom.
"""

import os

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/status") -> http://localhost:8001/api/status."""
    return f"{API_URL}{path}"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


@pytest.fixture
def client():
    """Sync httpx client rooted at /api — the default for endpoint tests.

    Example:
        def test_status(client):
            assert client.get("/status").status_code == 200
    """
    with httpx.Client(base_url=API_URL, timeout=30.0) as c:
        yield c


@pytest_asyncio.fixture
async def aclient():
    """Async variant, for tests that also await motor/backend helpers directly."""
    async with httpx.AsyncClient(base_url=API_URL, timeout=30.0) as c:
        yield c


# --- app-specific fixtures below this line ---

PASSWORD = "Gmp@2026!"
CSRF_HEADERS = {"X-Requested-With": "gmp"}


def login_client(email: str, password: str = PASSWORD) -> httpx.Client:
    """Return an httpx.Client logged in as the given user, cookie attached.

    The session cookie is issued with Secure=true (COOKIE_SECURE, correct for the
    HTTPS preview ingress). httpx auto-withholds Secure cookies over plain http://
    on localhost, so we re-attach the token manually after login.
    """
    c = httpx.Client(base_url=API_URL, timeout=30.0, headers=CSRF_HEADERS)
    r = c.post("/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    token = r.cookies.get("gmp_session")
    assert token, "login did not return a gmp_session cookie"
    c.cookies.set("gmp_session", token)
    return c


@pytest.fixture(scope="session")
def superadmin_client():
    c = login_client("superadmin@networkgmp.id")
    yield c
    c.close()


@pytest.fixture(scope="session")
def finance_client():
    c = login_client("finance@networkgmp.id")
    yield c
    c.close()


@pytest.fixture(scope="session")
def teknisi_client():
    c = login_client("teknisi1@networkgmp.id")
    yield c
    c.close()
