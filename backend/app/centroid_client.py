"""Thin async client for the Centroid public API (subtitle translation + linguistic QC)."""
from typing import Any, Dict

import httpx
from fastapi import HTTPException

from app.config import CENTROID_API_URL, CENTROID_API_KEY, CENTROID_TIMEOUT_SEC


def is_configured() -> bool:
    return bool(CENTROID_API_URL and CENTROID_API_KEY)


def _require_config() -> None:
    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="Centroid is not configured. Set CENTROID_API_URL and CENTROID_API_KEY in backend/.env.",
        )


def _headers() -> Dict[str, str]:
    return {"x-api-key": CENTROID_API_KEY, "Content-Type": "application/json"}


async def post(path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    _require_config()
    try:
        async with httpx.AsyncClient(timeout=CENTROID_TIMEOUT_SEC) as client:
            res = await client.post(f"{CENTROID_API_URL}/api/v1{path}", json=payload, headers=_headers())
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Centroid took too long to respond. Try fewer languages or a shorter file.")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Centroid: {e}")
    if res.status_code == 401:
        raise HTTPException(status_code=502, detail="Centroid rejected the API key. Check CENTROID_API_KEY.")
    if res.status_code >= 400:
        try:
            detail = res.json().get("detail") or res.json().get("error") or res.text
        except Exception:
            detail = res.text
        raise HTTPException(status_code=res.status_code if res.status_code < 500 else 502, detail=str(detail)[:500])
    return res.json()


async def status() -> Dict[str, Any]:
    if not is_configured():
        return {"configured": False, "reachable": False}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(f"{CENTROID_API_URL}/api/v1/subtitles/capabilities", headers=_headers())
        if res.status_code == 200:
            return {"configured": True, "reachable": True, **res.json()}
        return {"configured": True, "reachable": False, "error": f"HTTP {res.status_code}"}
    except httpx.HTTPError as e:
        return {"configured": True, "reachable": False, "error": str(e)}
