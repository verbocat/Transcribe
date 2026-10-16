"""Dubbing Studio editor: the edit (sequence) shared by the browser editor and the server mix.

The edit is a list of tracks and clips:
  tracks  V1 video, A1 original audio, A2 background, then one dub track per speaker ("S:<speaker>").
  clips   {id, track, source: media | background | line, line (line id), start, in, out, disabled, anchor, link}
          `start` is where the clip sits on the timeline, `in`/`out` are the part of its source that plays
          (`out` None = to the end of the source). `anchor` remembers the line's own start (start + shift) when the clip
          was last placed, so retiming a line elsewhere (Transcript tab, shift slider) moves its clips by the same amount.
          Clips with the same `link` (video and its audio pieces) are selected, cut and trimmed together in the editor.
          Audio levels on a clip: `gain` (dB), `fade_in` / `fade_out` (seconds, equal-power curves) and `keyframes`
          [{t, db}] at source times (so they stay with the sound when the clip is slipped or cut), interpolated in dB.
  tracks also carry `volume` (fader, linear 0..2) and, for the original and background, `duck`
          {on, amount (dB), attack, release}: the track dips while any dub line plays.
  master         {volume}: the master fader, applied to the whole mix.
  Pictures (video projects): T2 "Subtitles" and T1 "Text" overlay tracks sit above V1. A text clip (source "text") has
          `text`, `style` and `image`: the id of a PNG the browser drew from them at the video's size (so the render uses
          exactly what the preview showed, scripts shaped by the browser) and uploaded. Video clips can carry `effects`
          {brightness, contrast, saturation (multipliers, 1 = unchanged), blur (fraction of the picture height)} and a
          `transition` {type: dissolve | dip, duration} with the clip just before them; fade_in / fade_out on a video or
          text clip fade it from / to black (text: to transparent). A muted overlay or video track is hidden.
  removed_lines  lines taken off the timeline on purpose (deleted or rippled away); they are not put back automatically.
  seeded         media tracks that have had their starting clip, so a track the user emptied stays empty.
A line clip always sits on its speaker's track; changing a line's speaker moves its clips there. A line can have several
clips (cut with the razor). Media tracks can be cut, moved and trimmed like any other.
"""
from typing import Any, Callable, Dict, List, Optional

VERSION = 2
MEDIA_TRACKS = ("V1", "A1", "A2")
OVERLAY_TRACKS = ("T1", "T2")
TEXT_LIMIT = 36000.0  # a text clip has no source of its own; its length is just out - in
TEXT_FONTS = ("sans", "serif", "mono")
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
        for k in ("mute", "solo", "locked", "volume", "duck"):
            if k in prev:
                base[k] = prev[k]
        return base

    out = []
    if p.get("is_video"):
        out.append(tr("T2", "overlay", "subtitles", "Subtitles"))
        out.append(tr("T1", "overlay", "text", "Text"))
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
        elif c.get("source") == "text" and c.get("track") in ids and c.get("track") in OVERLAY_TRACKS:
            c = dict(c)
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
    master = {"volume": float((edit.get("master") or {}).get("volume", 1.0))}
    return {"version": VERSION, "tracks": tracks, "clips": clips, "removed_lines": removed, "seeded": seeded, "master": master}


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
            tr = {"id": t["id"][:60], "mute": bool(t.get("mute")), "solo": bool(t.get("solo")),
                  "locked": bool(t.get("locked")), "volume": _num(t.get("volume", 1.0), 0.0, 2.0)}
            d = t.get("duck")
            if isinstance(d, dict):
                tr["duck"] = {"on": bool(d.get("on")), "amount": _num(d.get("amount", -12.0), -40.0, 0.0),
                              "attack": _num(d.get("attack", 0.25), 0.0, 3.0), "release": _num(d.get("release", 0.5), 0.0, 5.0)}
            tracks.append(tr)
    clips = []
    seen = set()
    for c in raw["clips"]:
        if not isinstance(c, dict) or c.get("source") not in ("media", "background", "line", "text"):
            continue
        cid = str(c.get("id") or "")[:40]
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out = {"id": cid, "track": str(c.get("track") or "")[:60], "source": c["source"], "disabled": bool(c.get("disabled"))}
        if c.get("link"):
            out["link"] = str(c["link"])[:40]
        if c.get("gain") is not None:
            out["gain"] = _num(c["gain"], -60.0, 20.0)
        for k in ("fade_in", "fade_out"):
            if c.get(k) is not None:
                out[k] = _num(c[k], 0.0, 600.0)
        if isinstance(c.get("keyframes"), list) and c["keyframes"]:
            kfs = [{"t": _num(k.get("t"), 0.0, limit), "db": _num(k.get("db", 0.0), -60.0, 20.0)}
                   for k in c["keyframes"][:500] if isinstance(k, dict)]
            out["keyframes"] = sorted(kfs, key=lambda k: k["t"])
        if isinstance(c.get("effects"), dict):
            fx = {k: _num(c["effects"].get(k, d), lo, hi) for k, (d, lo, hi) in EFFECT_LIMITS.items()}
            if any(abs(fx[k] - EFFECT_LIMITS[k][0]) > 1e-6 for k in fx):
                out["effects"] = fx
        tr_raw = c.get("transition")
        if isinstance(tr_raw, dict) and tr_raw.get("type") in ("dissolve", "dip"):
            out["transition"] = {"type": tr_raw["type"], "duration": _num(tr_raw.get("duration", 1.0), 0.04, 10.0)}
        if c["source"] == "line":
            if not isinstance(c.get("line"), int):
                continue
            out["line"] = c["line"]
            src_len = line_lengths.get(c["line"])
            if c.get("anchor") is not None:
                out["anchor"] = _num(c["anchor"], 0.0, limit)
        elif c["source"] == "text":
            out["text"] = str(c.get("text") or "")[:1000]
            out["style"] = _clean_style(c.get("style"))
            img = str(c.get("image") or "")
            if img and len(img) <= 64 and all(ch in "0123456789abcdef" for ch in img):
                out["image"] = img
            if c.get("out") is None:
                raise ValueError("A text clip needs a length.")
            src_len = TEXT_LIMIT
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
    master = {"volume": _num((raw.get("master") or {}).get("volume", 1.0), 0.0, 2.0)}
    return reconcile(p, {"version": VERSION, "tracks": tracks, "clips": clips, "removed_lines": removed, "seeded": seeded, "master": master})


EFFECT_LIMITS = {"brightness": (1.0, 0.0, 3.0), "contrast": (1.0, 0.0, 3.0), "saturation": (1.0, 0.0, 3.0), "blur": (0.0, 0.0, 0.05)}


def _hex(v, default: str) -> str:
    v = str(v or "")
    return v.lower() if len(v) == 7 and v[0] == "#" and all(ch in "0123456789abcdefABCDEF" for ch in v[1:]) else default


def _clean_style(raw) -> Dict[str, Any]:
    """Text style: only known keys, within range (sizes are fractions of the picture height, positions of its size)."""
    r = raw if isinstance(raw, dict) else {}

    def num(k, d, lo, hi):
        try:
            return _num(r.get(k, d), lo, hi)
        except ValueError:
            return d
    return {
        "font": r.get("font") if r.get("font") in TEXT_FONTS else "sans", "size": num("size", 0.06, 0.01, 0.4),
        "color": _hex(r.get("color"), "#ffffff"), "bold": bool(r.get("bold", True)), "italic": bool(r.get("italic")),
        "align": r.get("align") if r.get("align") in ("left", "center", "right") else "center",
        "x": num("x", 0.5, 0.0, 1.0), "y": num("y", 0.85, 0.0, 1.0), "width": num("width", 0.8, 0.1, 1.0),
        "box": bool(r.get("box")), "box_color": _hex(r.get("box_color"), "#000000"), "box_opacity": num("box_opacity", 0.6, 0.0, 1.0),
        "outline": num("outline", 0.0, 0.0, 0.03), "outline_color": _hex(r.get("outline_color"), "#000000"), "shadow": bool(r.get("shadow")),
    }


def audible(edit: Dict[str, Any]) -> Dict[str, bool]:
    """Which tracks play: not muted, and when any track is soloed, only the soloed ones."""
    tracks = edit.get("tracks") or []
    solo = any(t.get("solo") for t in tracks)
    return {t["id"]: (not t.get("mute")) and (t.get("solo") or not solo) for t in tracks}


def _length(c: Dict[str, Any], src_len: float) -> float:
    out = src_len if c.get("out") is None else min(float(c["out"]), src_len)
    return max(0.0, out - float(c.get("in") or 0.0))


def visible(edit: Dict[str, Any]) -> Dict[str, bool]:
    """Which picture tracks show (video and overlays): not muted (hidden)."""
    return {t["id"]: not t.get("mute") for t in edit.get("tracks") or [] if t.get("kind") in ("video", "overlay")}


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
        elif c.get("source") == "text":
            src = TEXT_LIMIT
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


def transition_at(clips: List[Dict[str, Any]], i: int, dur: float) -> Optional[Dict[str, Any]]:
    """The transition into clips[i] (sorted, enabled clips of one video track) from the clip just before it, with its
    duration limited so it fits: a dissolve needs half its length of spare source after the first clip's out and before
    the second clip's in (handles), and neither clip may be shorter than it. None when there is no usable transition."""
    c = clips[i]
    t = c.get("transition")
    if not t or i == 0:
        return None
    left = clips[i - 1]
    l_len, r_len = _length(left, dur), _length(c, dur)
    if abs(left["start"] + l_len - c["start"]) > 1e-3:
        return None  # not touching: there is no cut to transition across
    d = min(float(t.get("duration", 1.0)), l_len, r_len)
    if t.get("type") == "dissolve":
        l_out = dur if left.get("out") is None else min(float(left["out"]), dur)
        d = min(d, 2 * (dur - l_out), 2 * float(c.get("in") or 0.0))
    if d < 0.04:
        return None
    return {"type": t["type"], "duration": round(d, 3), "cut": c["start"]}


def video_plan(p: Dict[str, Any], edit: Dict[str, Any], total: float) -> Dict[str, Any]:
    """The edited picture as back-to-back pieces for the renderer:
    {"pieces": [{"kind": "clip", in, out, effects, fade_in, fade_out, xfade (seconds of dissolve with the piece before)}
                or {"kind": "gap", "duration"}], "plain": bool}. `plain` means the source can be used untouched."""
    dur = float(p.get("duration") or 0)
    shown = visible(edit).get("V1", True)
    clips = sorted((c for c in edit.get("clips") or [] if c.get("track") == "V1" and not c.get("disabled")), key=lambda c: c["start"]) if shown else []
    pieces: List[Dict[str, Any]] = []
    t = 0.0
    trans = [transition_at(clips, i, dur) for i in range(len(clips))]
    for i, c in enumerate(clips):
        a = float(c.get("in") or 0.0)
        b = dur if c.get("out") is None else min(float(c["out"]), dur)
        start = float(c["start"])
        if start < t - 1e-3:  # overlap (the editor does not make these): start where the last piece ended
            a += t - start
            start = t
        if b - a <= 0.01:
            continue
        if start - t > 0.01:
            pieces.append({"kind": "gap", "duration": round(start - t, 3)})
        fi, fo = float(c.get("fade_in") or 0.0), float(c.get("fade_out") or 0.0)
        xfade = 0.0
        if trans[i]:
            if trans[i]["type"] == "dissolve":
                xfade = trans[i]["duration"]
                a -= xfade / 2  # the head handle; the piece before got its tail handle
            else:
                fi = max(fi, trans[i]["duration"] / 2)  # dip to black: fade in from black after the cut
        nxt = trans[i + 1] if i + 1 < len(trans) else None
        if nxt:
            if nxt["type"] == "dissolve":
                b += nxt["duration"] / 2
            else:
                fo = max(fo, nxt["duration"] / 2)
        tail = nxt["duration"] / 2 if nxt and nxt["type"] == "dissolve" else 0.0
        pieces.append({"kind": "clip", "in": round(a, 3), "out": round(b, 3), "effects": c.get("effects") or {},
                       "fade_in": fi, "fade_out": fo, "xfade": xfade, "head": xfade / 2, "tail": tail})
        t = start + (b - a) - (xfade / 2 if xfade else 0) - (nxt["duration"] / 2 if nxt and nxt["type"] == "dissolve" else 0)
    if total - t > 0.01:
        pieces.append({"kind": "gap", "duration": round(total - t, 3)})
    plain = (len(pieces) == 1 and pieces[0]["kind"] == "clip" and pieces[0]["in"] < 0.01 and pieces[0]["out"] >= dur - 0.05
             and not pieces[0]["effects"] and not pieces[0]["fade_in"] and not pieces[0]["fade_out"])
    return {"pieces": pieces, "plain": plain}


def overlay_items(edit: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Text clips to draw, bottom track first: {track, start, end, image, fade_in, fade_out}. Hidden tracks, disabled
    clips and clips without an uploaded picture are left out."""
    shown = visible(edit)
    out = []
    for track in ("T1", "T2"):
        if not shown.get(track):
            continue
        for c in sorted((c for c in edit.get("clips") or [] if c.get("track") == track and c.get("source") == "text" and not c.get("disabled")), key=lambda c: c["start"]):
            length = _length(c, TEXT_LIMIT)
            if length > 0.01 and c.get("image"):
                out.append({"track": track, "start": float(c["start"]), "end": float(c["start"]) + length, "image": c["image"],
                            "fade_in": float(c.get("fade_in") or 0.0), "fade_out": float(c.get("fade_out") or 0.0)})
    return out


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
                       "file": m["file"], "gain": float(seg.get("gain", 1.0)) * float(vol.get(c["track"], 1.0)),
                       "clip": c if has_levels(c) else None})
    return placed


# --------------------------------------------------------------------------------------------- levels
# These formulas are mirrored in the editor (frontend/src/components/dubbing/editor/audioModel.js) so the browser preview
# and the render agree; both test suites check the same numbers.
def db_to_gain(db):
    import numpy as np
    return np.power(10.0, np.asarray(db, dtype="float64") / 20.0)


def has_levels(c: Dict[str, Any]) -> bool:
    return bool(c.get("gain") or c.get("fade_in") or c.get("fade_out") or c.get("keyframes"))


def _fade(u):
    import numpy as np
    return np.sin(np.pi / 2 * np.clip(u, 0.0, 1.0))


def clip_gain(c: Dict[str, Any], x, length: float):
    """Linear gain of a clip at clip-local times x (seconds from the clip's start): gain, keyframes, fades."""
    import numpy as np
    x = np.asarray(x, dtype="float64")
    db = np.full(x.shape, float(c.get("gain") or 0.0))
    kfs = c.get("keyframes") or []
    if kfs:
        db = db + np.interp(float(c.get("in") or 0.0) + x, [k["t"] for k in kfs], [k["db"] for k in kfs])
    g = db_to_gain(db)
    fi, fo = float(c.get("fade_in") or 0.0), float(c.get("fade_out") or 0.0)
    if fi > 0:
        g = g * np.where(x < fi, _fade(x / fi), 1.0)
    if fo > 0:
        g = g * np.where(length - x < fo, _fade((length - x) / fo), 1.0)
    return g


def speech_regions(p: Dict[str, Any], edit: Dict[str, Any], line_meta: Dict[str, Any]) -> List[tuple]:
    """Where dub speech plays: (start, end) of every line that is heard, sorted."""
    return sorted((l["start"], l["start"] + l["duration"]) for l in line_placements(p, edit, line_meta))


def duck_points(regions: List[tuple], duck: Dict[str, Any]) -> tuple:
    """Breakpoints (times, dB) of a ducking envelope: down by `amount` while speech plays, easing in `attack` seconds
    before it and out `release` seconds after it. Speech closer together than attack + release counts as one stretch."""
    att, rel, amt = float(duck.get("attack", 0.25)), float(duck.get("release", 0.5)), float(duck.get("amount", -12.0))
    merged: List[List[float]] = []
    for a, b in regions:
        if merged and a - merged[-1][1] < att + rel:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    xs, ys = [], []
    for a, b in merged:
        xs += [a - att, a, b, b + rel]
        ys += [0.0, amt, amt, 0.0]
    return xs, ys


def track_gain_fn(p: Dict[str, Any], edit: Dict[str, Any], track: str, line_meta: Dict[str, Any]) -> Optional[Callable]:
    """Gain over timeline time for a media track (clip levels, fader, ducking, master), or None when it is 1 everywhere."""
    import numpy as np
    dur = float(p.get("duration") or 0)
    tr = next((t for t in edit.get("tracks") or [] if t["id"] == track), {})
    vol = float(tr.get("volume", 1.0)) * float((edit.get("master") or {}).get("volume", 1.0))
    duck = tr.get("duck") if (tr.get("duck") or {}).get("on") else None
    clips = sorted((c for c in edit.get("clips") or [] if c.get("track") == track and not c.get("disabled")), key=lambda c: c["start"])
    if not duck and abs(vol - 1.0) < 1e-6 and not any(has_levels(c) for c in clips):
        return None
    xs, ys = duck_points(speech_regions(p, edit, line_meta), duck) if duck else ([], [])

    def fn(t):
        t = np.asarray(t, dtype="float64")
        g = np.zeros(t.shape)
        for c in clips:
            length = _length(c, dur)
            m = (t >= c["start"]) & (t < c["start"] + length)
            if m.any():
                g[m] = clip_gain(c, t[m] - c["start"], length) if has_levels(c) else 1.0
        g = g * vol
        if xs:
            g = g * db_to_gain(np.interp(t, xs, ys, left=0.0, right=0.0))
        return g
    return fn
