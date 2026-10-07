"""Thin async client for the Centroid public API (subtitle translation + linguistic QC)."""
from typing import Any, Dict, List

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


def drop_misaligned_translations(data: Dict[str, Any], source_cues: List[Dict[str, Any]]) -> None:
    """A language track is only usable if it has one cue per source cue with the same timing, because the editor
    pairs them by position. Move any language that does not line up into 'errors' instead of showing shifted text."""
    results = data.get("results") or {}
    errors = data.setdefault("errors", {})
    for lang in list(results):
        cues = (results[lang] or {}).get("cues") or []
        aligned = len(cues) == len(source_cues) and all(
            abs(float(c.get("start") or 0) - float(s.get("start") or 0)) < 0.002
            and abs(float(c.get("end") or 0) - float(s.get("end") or 0)) < 0.002
            for c, s in zip(cues, source_cues)
        )
        if not aligned:
            results.pop(lang)
            errors[lang] = (f"Centroid returned {len(cues)} subtitles for {len(source_cues)} source subtitles, or changed "
                            "their timing, so this translation was not loaded. Please translate again.")


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
