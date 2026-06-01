from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["frontend"])

_TEMPLATE = (Path(__file__).parent.parent / "templates" / "index.html").read_text(
    encoding="utf-8"
)


@router.get("/", include_in_schema=False)
async def index():
    return HTMLResponse(_TEMPLATE)
