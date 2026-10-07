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


_TIME_TOL = 0.002


def _same_time(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return (abs(float(a.get("start") or 0) - float(b.get("start") or 0)) < _TIME_TOL
            and abs(float(a.get("end") or 0) - float(b.get("end") or 0)) < _TIME_TOL)


def _fmt(t: float) -> str:
    ms = max(0, int(round(float(t) * 1000)))
    return f"{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}"


def _srt(cues: List[Dict[str, Any]]) -> str:
    return "\n".join(
        f"{n}\n{_fmt(c['start'])} --> {_fmt(c['end'])}\n{(c.get('target') or c.get('source') or '').strip()}\n"
        for n, c in enumerate(cues, start=1)
    )


def align_translations(data: Dict[str, Any], source_cues: List[Dict[str, Any]]) -> None:
    """The editor pairs translated cues with source cues by position, so a language whose cues do not line up would
    shift every later subtitle. Such a language is still loaded, but rebuilt so it has exactly one cue per source
    cue (matched by timing): a source cue with no matching translation keeps its source text and gets an
    'align_error' on that one subtitle, and translated cues that match no source cue are dropped and listed in
    'warnings'. A language that already lines up is left untouched."""
    for lang, res in list((data.get("results") or {}).items()):
        cues = (res or {}).get("cues") or []
        if len(cues) == len(source_cues) and all(_same_time(c, s) for c, s in zip(cues, source_cues)):
            continue
        pool = list(cues)
        rebuilt: List[Dict[str, Any]] = []
        flagged = 0
        for n, src in enumerate(source_cues, start=1):
            hit = next((c for c in pool if _same_time(c, src)), None)
            cue = {"index": n, "start": src["start"], "end": src["end"], "source": src.get("text", ""), "target": ""}
            if hit is not None:
                pool.remove(hit)
                cue["target"] = hit.get("target") or ""
            if not cue["target"]:
                flagged += 1
                cue["align_error"] = "No translation came back for this subtitle. The text shown is the original; translate it again or type it in."
            rebuilt.append(cue)
        warnings = [w for w in (res.get("warnings") or []) if w.get("type") != "alignment"]
        for c in rebuilt:
            if c.get("align_error"):
                warnings.append({"index": c["index"], "type": "alignment", "message": c["align_error"]})
        res["cues"] = rebuilt
        res["srt"] = _srt(rebuilt)
        res["warnings"] = warnings
        res["align"] = {"returned": len(cues), "expected": len(source_cues), "unmatched_extra": len(pool), "flagged": flagged}


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
