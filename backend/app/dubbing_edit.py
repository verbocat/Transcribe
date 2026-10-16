"""Dubbing Studio editor: the edit (sequence) shared by the browser editor and the server mix.

The edit is a list of tracks and clips:
  tracks  V1 video, A1 original audio, A2 background, then one dub track per speaker ("S:<speaker>").
  clips   {id, track, source: media | background | line, line (line id), start, in, out, disabled, anchor, link}
          `start` is where the clip sits on the timeline, `in`/`out` are the part of its source that plays
          (`out` None = to the end of the source). `anchor` remembers the line's own start (start + shift) when the clip
          was last placed, so retiming a line elsewhere (Transcript tab, shift slider) moves its clips by the same amount.
          Clips with the same `link` (video and its audio pieces) are selected, cut and trimmed together in the editor.
  removed_lines  lines taken off the timeline on purpose (deleted or rippled away); they are not put back automatically.
  seeded         media tracks that have had their starting clip, so a track the user emptied stays empty.
A line clip always sits on its speaker's track; changing a line's speaker moves its clips there. A line can have several
clips (cut with the razor). Media tracks can be cut, moved and trimmed like any other.
"""
from typing import Any, Dict, List, Optional

VERSION = 2
MEDIA_TRACKS = ("V1", "A1", "A2")
MEDIA_LINK = "m0"


def _r(v: float) -> float:
    return round(float(v), 3)


def speaker_track(name: str) -> str:
    return f"S:{name}"


def _line_anchor(seg: Dict[str, Any]) -> float:
    return _r(max(0.0, seg["start"] + seg.get("shift", 0.0)))


def _line_clip(seg: Dict[str, Any]) -> Dict[str, Any]:
    a = _line_anchor(seg)
    return {"id": f"L{seg['id']}", "track": speaker_track(seg["speaker"]), "source": "line", "line": seg["id"],
            "start": a, "in": 0.0, "out": None, "disabled": False, "anchor": a}


def _tracks(p: Dict[str, Any], old: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    keep = {t["id"]: t for t in old or []}

    def tr(tid: str, kind: str, role: str, name: str, **extra) -> Dict[str, Any]:
        base = {"id": tid, "kind": kind, "role": role, "name": name, "mute": False, "solo": False, "locked": False, "volume": 1.0}
        base.update(extra)
        prev = keep.get(tid) or {}
        for k in ("mute", "solo", "locked", "volume"):
            if k in prev:
                base[k] = prev[k]
        return base

    out = []
    if p.get("is_video"):
        out.append(tr("V1", "video", "video", "Video"))
    # the original speech is a reference while editing; it is not part of the dub mix, so it starts muted
    out.append(tr("A1", "audio", "original", "Original", mute=True))
    if p.get("stems"):
        out.append(tr("A2", "audio", "background", "Background"))
    seen = []
    for s in p.get("segments") or []:
        if s["speaker"] not in seen:
            seen.append(s["speaker"])
    for name in seen:
        out.append(tr(speaker_track(name), "audio", "speaker", name, speaker=name))
    return out


def seed(p: Dict[str, Any]) -> Dict[str, Any]:
    """The starting edit: the media on its tracks and every line at its own time on its speaker's track."""
    return reconcile(p, {"version": VERSION, "tracks": [], "clips": [], "removed_lines": [], "seeded": []})


def reconcile(p: Dict[str, Any], edit: Dict[str, Any]) -> Dict[str, Any]:
    """Bring a stored edit in line with the project as it is now: tracks for the media and speakers that exist, clips
    for new lines (at their own time) and newly available media, none for deleted lines; lines retimed elsewhere move."""
    tracks = _tracks(p, edit.get("tracks"))
    ids = {t["id"] for t in tracks}
    dur = _r(p.get("duration") or 0)
    segs = {s["id"]: s for s in p.get("segments") or []}
    old_clips = edit.get("clips") or []
    seeded = edit.get("seeded")
    if seeded is None:  # edits saved before media could be cut: every media track that has a clip was seeded
        seeded = sorted({c["track"] for c in old_clips if c.get("source") != "line" and c.get("track") in MEDIA_TRACKS})
    seeded = [t for t in seeded if t in MEDIA_TRACKS]
    removed = [i for i in (edit.get("removed_lines") or []) if i in segs]
    clips: List[Dict[str, Any]] = []
    have_lines = set()
    seen_ids = set()
    for c in old_clips:
        if c.get("id") in seen_ids:
            continue
        if c.get("source") == "line":
            seg = segs.get(c.get("line"))
            if seg is None or c["line"] in removed:
                continue
            c = dict(c, track=speaker_track(seg["speaker"]))
            a = _line_anchor(seg)
            if c.get("anchor") is not None and abs(a - c["anchor"]) > 1e-3:
                c["start"] = _r(max(0.0, c["start"] + a - c["anchor"]))
            c["anchor"] = a
            have_lines.add(c["line"])
        elif c.get("track") in ids and c.get("track") in MEDIA_TRACKS:
            c = dict(c)
            if not c.get("link") and c["id"] in MEDIA_TRACKS:
                c["link"] = MEDIA_LINK  # the first media clips (from before linking existed) belong together
        else:
            continue
        seen_ids.add(c["id"])
        clips.append(c)
    for tid, src in (("V1", "media"), ("A1", "media"), ("A2", "background")):
        if tid in ids and tid not in seeded:
            if not any(c["track"] == tid for c in clips):
                clips.append({"id": tid, "track": tid, "source": src, "start": 0.0, "in": 0.0, "out": dur, "disabled": False, "link": MEDIA_LINK})
            seeded.append(tid)
    for sid, seg in segs.items():
        if sid not in have_lines and sid not in removed:
            clips.append(_line_clip(seg))
    return {"version": VERSION, "tracks": tracks, "clips": clips, "removed_lines": removed, "seeded": seeded}


def _num(v, lo: float, hi: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError("A clip has an invalid time.")
    if x != x:
        raise ValueError("A clip has an invalid time.")
    return _r(max(lo, min(hi, x)))


def clean(p: Dict[str, Any], raw: Any, line_lengths: Dict[int, float]) -> Dict[str, Any]:
    """Validate an edit sent by the browser. Only known fields survive; times are clamped to sane ranges.
    Raises ValueError with a message for the user when the edit cannot be used."""
    if not isinstance(raw, dict) or not isinstance(raw.get("clips"), list) or not isinstance(raw.get("tracks"), list):
        raise ValueError("Send the edit with its tracks and clips.")
    if len(raw["clips"]) > 20000:
        raise ValueError("This edit has too many clips.")
    dur = float(p.get("duration") or 0)
    limit = dur * 2 + 600.0
    tracks = []
    for t in raw["tracks"]:
        if isinstance(t, dict) and isinstance(t.get("id"), str):
            tracks.append({"id": t["id"][:60], "mute": bool(t.get("mute")), "solo": bool(t.get("solo")),
                           "locked": bool(t.get("locked")), "volume": _num(t.get("volume", 1.0), 0.0, 2.0)})
    clips = []
    seen = set()
    for c in raw["clips"]:
        if not isinstance(c, dict) or c.get("source") not in ("media", "background", "line"):
            continue
        cid = str(c.get("id") or "")[:40]
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out = {"id": cid, "track": str(c.get("track") or "")[:60], "source": c["source"], "disabled": bool(c.get("disabled"))}
        if c.get("link"):
            out["link"] = str(c["link"])[:40]
        if c["source"] == "line":
            if not isinstance(c.get("line"), int):
                continue
            out["line"] = c["line"]
            src_len = line_lengths.get(c["line"])
            if c.get("anchor") is not None:
                out["anchor"] = _num(c["anchor"], 0.0, limit)
        else:
            src_len = dur
        out["start"] = _num(c.get("start", 0.0), 0.0, limit)
        out["in"] = _num(c.get("in", 0.0), 0.0, src_len if src_len else limit)
        if c.get("out") is None:
            out["out"] = None
        else:
            o = _num(c["out"], 0.0, src_len if src_len else limit)
            if o <= out["in"] + 0.02:
                raise ValueError("A clip was trimmed to nothing.")
            out["out"] = o
        clips.append(out)
    removed = [i for i in raw.get("removed_lines") or [] if isinstance(i, int)]
    seeded = [t for t in raw.get("seeded") or [] if t in MEDIA_TRACKS]
    return reconcile(p, {"version": VERSION, "tracks": tracks, "clips": clips, "removed_lines": removed, "seeded": seeded})


def audible(edit: Dict[str, Any]) -> Dict[str, bool]:
    """Which tracks play: not muted, and when any track is soloed, only the soloed ones."""
    tracks = edit.get("tracks") or []
    solo = any(t.get("solo") for t in tracks)
    return {t["id"]: (not t.get("mute")) and (t.get("solo") or not solo) for t in tracks}


def _length(c: Dict[str, Any], src_len: float) -> float:
    out = src_len if c.get("out") is None else min(float(c["out"]), src_len)
    return max(0.0, out - float(c.get("in") or 0.0))


def sequence_end(p: Dict[str, Any], edit: Dict[str, Any], line_meta: Dict[str, Any]) -> float:
    """Where the edit ends: the end of its last clip (the media length when there are no clips)."""
    segs = {s["id"]: s for s in p.get("segments") or []}
    dur = float(p.get("duration") or 0)
    end = 0.0
    for c in edit.get("clips") or []:
        if c.get("source") == "line":
            seg = segs.get(c.get("line"))
            m = line_meta.get(str(c.get("line"))) or {}
            if not seg:
                continue
            src = float(m["duration"]) if m.get("file") else seg["end"] - seg["start"]
        else:
            src = dur
        end = max(end, float(c["start"]) + _length(c, src))
    return round(end or dur, 3)


def media_placements(p: Dict[str, Any], edit: Dict[str, Any], track: str) -> List[Dict[str, float]]:
    """The pieces of the source that play on a media track, in timeline order: [{start, in, out}]. Disabled clips are gaps."""
    dur = float(p.get("duration") or 0)
    out = []
    for c in sorted((c for c in edit.get("clips") or [] if c.get("track") == track and not c.get("disabled")), key=lambda c: c["start"]):
        a = float(c.get("in") or 0.0)
        b = dur if c.get("out") is None else min(float(c["out"]), dur)
        if b - a > 0.01:
            out.append({"start": float(c["start"]), "in": a, "out": b})
    return out


def is_identity(pieces: List[Dict[str, float]], duration: float) -> bool:
    """True when a media track plays its source untouched (one piece, from the top, full length, at 0)."""
    return len(pieces) == 1 and abs(pieces[0]["start"]) < 0.01 and pieces[0]["in"] < 0.01 and pieces[0]["out"] >= duration - 0.05


def concat_plan(pieces: List[Dict[str, float]], total: float) -> List[tuple]:
    """Turn placed pieces into a back-to-back list of ("clip", in, out) and ("gap", seconds), filling up to `total`.
    Overlaps (which the editor does not make) are resolved by starting the later piece where the earlier one ends."""
    plan: List[tuple] = []
    t = 0.0
    for pc in pieces:
        a, b, start = pc["in"], pc["out"], pc["start"]
        if start < t:  # overlap: skip the part already covered
            a += t - start
            start = t
        if b - a <= 0.01:
            continue
        if start - t > 0.01:
            plan.append(("gap", round(start - t, 3)))
        plan.append(("clip", round(a, 3), round(b, 3)))
        t = start + (b - a)
    if total - t > 0.01:
        plan.append(("gap", round(total - t, 3)))
    return plan


def line_placements(p: Dict[str, Any], edit: Dict[str, Any], line_meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Where each line's audio plays in the mix: timeline start, offset into the line's audio and how long, plus gain
    (the line's own level times its track volume). Disabled clips, muted lines and silent tracks are left out."""
    segs = {s["id"]: s for s in p.get("segments") or []}
    on = audible(edit)
    vol = {t["id"]: t.get("volume", 1.0) for t in edit.get("tracks") or []}
    placed = []
    for c in edit.get("clips") or []:
        if c.get("source") != "line" or c.get("disabled") or not on.get(c["track"], False):
            continue
        seg = segs.get(c["line"])
        m = line_meta.get(str(c["line"])) or {}
        if not seg or seg.get("mute") or not m.get("file"):
            continue
        length = float(m["duration"])
        a = min(float(c.get("in") or 0.0), length)
        b = length if c.get("out") is None else min(float(c["out"]), length)
        if b - a <= 0.01:
            continue
        placed.append({"id": seg["id"], "speaker": seg["speaker"], "start": float(c["start"]), "offset": a, "duration": b - a,
                       "file": m["file"], "gain": float(seg.get("gain", 1.0)) * float(vol.get(c["track"], 1.0))})
    return placed
