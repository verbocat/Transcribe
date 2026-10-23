"""Staged load test for the live Noun API, read-only and compute endpoints only.

Ramps virtual users (VUs) through stages and stops early if the server degrades:
  * stage error rate (non-2xx/expected, timeouts) above --max-error-rate, or
  * stage p95 latency above --max-p95 seconds.

Writes a JSON and a self-contained HTML report to qa/load/reports/.

Usage:
  python loadtest.py --stages 5,10,20,40 --stage-seconds 60
  python loadtest.py --base http://127.0.0.1:8765 --no-auth      # dry run against a stub
"""
import argparse
import asyncio
import html
import json
import os
import random
import statistics
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import httpx

HERE = Path(__file__).parent
QA_ID = "qa-live-nonexistent-7f3c9e1a"
EVENTS = [
    {"id": 1, "start_time": 0.0, "end_time": 2.0, "text": "This is a QA load-test subtitle line."},
    {"id": 2, "start_time": 2.2, "end_time": 4.5, "text": "And a second, slightly longer line for the linter."},
]

# (name, method, path, json body, needs auth, expected statuses, weight)
SCENARIOS = [
    ("health", "GET", "/api/health", None, False, {200}, 40),
    ("auth_me", "GET", "/api/auth/me", None, True, {200}, 15),
    ("dubbing_config", "GET", "/api/dubbing/config", None, True, {200}, 10),
    # login required on these since the role gate (85e71f3)
    ("project_lookup_404", "GET", f"/api/projects/{QA_ID}", None, True, {404}, 10),
    ("subtitle_lint", "POST", "/api/subtitle/lint", {"events": EVENTS, "frame_rate": 24.0}, True, {200}, 15),
    ("subtitle_qc", "POST", "/api/subtitle/qc", {"cues": EVENTS, "target_lang": "en"}, True, {200}, 10),
]


def load_env():
    env = HERE.parent / "live" / ".env.live"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(p / 100 * (len(s) - 1)))))
    return s[k]


class Stats:
    def __init__(self):
        self.lat = defaultdict(list)      # scenario -> [seconds]
        self.codes = defaultdict(lambda: defaultdict(int))
        self.errors = defaultdict(int)    # scenario -> unexpected/exception count
        self.samples = []                 # (scenario, error_detail) first few
        self.recent = []                  # (finished_at, seconds, is_error) for the in-stage watchdog
        self.stop_reason = ""             # set by the watchdog to end the stage early

    def record(self, dt, is_error):
        self.recent.append((time.monotonic(), dt, is_error))

    def summary(self, elapsed):
        rows = {}
        all_lat, total, errs = [], 0, 0
        for name in sorted(set(self.lat) | set(self.errors)):
            lat = self.lat[name]
            n = sum(self.codes[name].values())
            rows[name] = {
                "requests": n, "rps": round(n / elapsed, 2) if elapsed else 0,
                "errors": self.errors[name], "error_rate": round(self.errors[name] / n, 4) if n else 0,
                "p50": round(pct(lat, 50), 3), "p90": round(pct(lat, 90), 3), "p95": round(pct(lat, 95), 3),
                "p99": round(pct(lat, 99), 3), "max": round(max(lat), 3) if lat else 0,
                "mean": round(statistics.fmean(lat), 3) if lat else 0,
                "codes": dict(self.codes[name]),
            }
            all_lat += lat
            total += n
            errs += self.errors[name]
        overall = {
            "requests": total, "rps": round(total / elapsed, 2) if elapsed else 0, "errors": errs,
            "error_rate": round(errs / total, 4) if total else 0,
            "p50": round(pct(all_lat, 50), 3), "p95": round(pct(all_lat, 95), 3),
            "p99": round(pct(all_lat, 99), 3), "max": round(max(all_lat), 3) if all_lat else 0,
        }
        return overall, rows


async def vu(client, token, scenarios, weights, stop_at, stats, think):
    while time.monotonic() < stop_at and not stats.stop_reason:
        name, method, path, body, needs_auth, ok, _ = random.choices(scenarios, weights)[0]
        headers = {"Authorization": f"Bearer {token}"} if needs_auth and token else {}
        t0 = time.monotonic()
        try:
            r = await client.request(method, path, json=body, headers=headers)
            dt = time.monotonic() - t0
            stats.lat[name].append(dt)
            stats.codes[name][str(r.status_code)] += 1
            bad = r.status_code not in ok
            stats.record(dt, bad)
            if bad:
                stats.errors[name] += 1
                if len(stats.samples) < 10:
                    stats.samples.append((name, f"HTTP {r.status_code}: {r.text[:150]}"))
        except Exception as e:  # timeouts, resets
            stats.codes[name][type(e).__name__] += 1
            stats.errors[name] += 1
            stats.record(time.monotonic() - t0, True)
            if len(stats.samples) < 10:
                stats.samples.append((name, f"{type(e).__name__}: {str(e)[:150]}"))
        await asyncio.sleep(random.uniform(*think))


async def watchdog(stats, stop_at, max_error_rate, max_p95, window=5.0, min_requests=30):
    """Ends the stage early when the last `window` seconds look unhealthy, instead of waiting
    for the stage to finish while the server is struggling."""
    while time.monotonic() < stop_at and not stats.stop_reason:
        await asyncio.sleep(1.0)
        cutoff = time.monotonic() - window
        recent = [x for x in stats.recent if x[0] >= cutoff]
        if len(recent) < min_requests:
            continue
        err = sum(1 for x in recent if x[2]) / len(recent)
        p95 = pct([x[1] for x in recent], 95)
        if err > max_error_rate:
            stats.stop_reason = f"error rate {err*100:.1f}% over the last {window:.0f}s"
        elif p95 > max_p95:
            stats.stop_reason = f"p95 {p95:.2f}s over the last {window:.0f}s"


async def run_stage(base, token, vus, seconds, think, timeout, max_error_rate, max_p95):
    scenarios = [s for s in SCENARIOS if token or not s[4]]
    weights = [s[6] for s in scenarios]
    stats = Stats()
    limits = httpx.Limits(max_connections=vus, max_keepalive_connections=vus)
    async with httpx.AsyncClient(base_url=base, timeout=timeout, limits=limits,
                                 headers={"User-Agent": "noun-live-qa-load/1.0"}) as client:
        start = time.monotonic()
        stop_at = start + seconds
        await asyncio.gather(watchdog(stats, stop_at, max_error_rate, max_p95),
                             *(vu(client, token, scenarios, weights, stop_at, stats, think) for _ in range(vus)))
        elapsed = time.monotonic() - start
    return stats, elapsed


def login(base):
    email, pwd = os.environ.get("LIVE_TEST_EMAIL", ""), os.environ.get("LIVE_TEST_PASSWORD", "")
    if not (email and pwd):
        return None
    r = httpx.post(base + "/api/auth/login", json={"email": email, "password": pwd}, timeout=30)
    if r.status_code != 200:
        raise SystemExit(f"login failed: HTTP {r.status_code}; not retrying (IP lockout risk)")
    data = r.json()
    if data.get("user", {}).get("is_admin"):
        raise SystemExit("test account is an admin; refusing to load-test with it")
    return data["token"]


def html_report(meta, results):
    def table(rows):
        head = "<tr><th>Endpoint</th><th>Requests</th><th>RPS</th><th>Errors</th><th>Error %</th>" \
               "<th>p50 s</th><th>p90 s</th><th>p95 s</th><th>p99 s</th><th>max s</th><th>Status codes</th></tr>"
        body = "".join(
            f"<tr><td>{html.escape(n)}</td><td>{r['requests']}</td><td>{r['rps']}</td><td>{r['errors']}</td>"
            f"<td>{r['error_rate']*100:.2f}</td><td>{r['p50']}</td><td>{r['p90']}</td><td>{r['p95']}</td>"
            f"<td>{r['p99']}</td><td>{r['max']}</td><td>{html.escape(json.dumps(r['codes']))}</td></tr>"
            for n, r in rows.items())
        return f"<table>{head}{body}</table>"

    stages = ""
    for s in results:
        o = s["overall"]
        verdict = "ABORTED: " + s["abort_reason"] if s["abort_reason"] else "OK"
        cls = "bad" if s["abort_reason"] else "good"
        stages += (f"<h2>{s['vus']} virtual users, {s['seconds']}s <span class='{cls}'>{html.escape(verdict)}</span></h2>"
                   f"<p>{o['requests']} requests, {o['rps']} req/s, error rate {o['error_rate']*100:.2f}%, "
                   f"p50 {o['p50']}s, p95 {o['p95']}s, p99 {o['p99']}s, max {o['max']}s</p>"
                   + table(s["endpoints"])
                   + ("<p>Sample errors:</p><ul>" + "".join(f"<li>{html.escape(a)}: {html.escape(b)}</li>" for a, b in s["samples"]) + "</ul>" if s["samples"] else ""))
    summary = "".join(
        f"<tr><td>{s['vus']}</td><td>{s['overall']['requests']}</td><td>{s['overall']['rps']}</td>"
        f"<td>{s['overall']['error_rate']*100:.2f}</td><td>{s['overall']['p50']}</td><td>{s['overall']['p95']}</td>"
        f"<td>{s['overall']['p99']}</td><td>{s['overall']['max']}</td><td>{'ABORTED' if s['abort_reason'] else 'OK'}</td></tr>"
        for s in results)
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Noun load test</title>
<style>body{{font-family:system-ui,sans-serif;margin:24px;color:#1b1f24}}table{{border-collapse:collapse;margin:8px 0 20px}}
td,th{{border:1px solid #d0d7de;padding:4px 8px;font-size:13px;text-align:right}}td:first-child,th:first-child{{text-align:left}}
th{{background:#f3f4f6}}.good{{color:#1a7f37}}.bad{{color:#cf222e}}</style></head><body>
<h1>Noun API load test</h1>
<p>Target: {html.escape(meta['base'])} &middot; started {meta['started']} &middot; think time {meta['think']}s &middot;
abort if error rate &gt; {meta['max_error_rate']*100:.0f}% or p95 &gt; {meta['max_p95']}s</p>
<h2>Summary by stage</h2><table><tr><th>VUs</th><th>Requests</th><th>RPS</th><th>Error %</th><th>p50 s</th>
<th>p95 s</th><th>p99 s</th><th>max s</th><th>Result</th></tr>{summary}</table>{stages}</body></html>"""


def main():
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("LIVE_API_URL", "").rstrip("/"))
    ap.add_argument("--stages", default="5,10,20,40", help="comma-separated virtual users per stage")
    ap.add_argument("--stage-seconds", type=int, default=60)
    ap.add_argument("--cooldown", type=int, default=15, help="pause between stages, seconds")
    ap.add_argument("--think", default="0.2,0.6", help="min,max pause per VU between requests")
    ap.add_argument("--timeout", type=float, default=15)
    ap.add_argument("--max-error-rate", type=float, default=0.05)
    ap.add_argument("--max-p95", type=float, default=3.0)
    ap.add_argument("--no-auth", action="store_true")
    a = ap.parse_args()
    if not a.base:
        raise SystemExit("no target: set LIVE_API_URL or pass --base")
    think = tuple(float(x) for x in a.think.split(","))
    token = None if a.no_auth else login(a.base)
    meta = {"base": a.base, "started": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "think": a.think,
            "max_error_rate": a.max_error_rate, "max_p95": a.max_p95, "authenticated": bool(token)}
    results = []
    try:
        for i, vus in enumerate(int(x) for x in a.stages.split(",")):
            if i:
                time.sleep(a.cooldown)
            print(f"\n== stage {i + 1}: {vus} VUs for {a.stage_seconds}s", flush=True)
            stats, elapsed = asyncio.run(run_stage(a.base, token, vus, a.stage_seconds, think, a.timeout,
                                                   a.max_error_rate, a.max_p95))
            overall, rows = stats.summary(elapsed)
            reason = ""
            if stats.stop_reason:
                reason = f"stopped after {elapsed:.0f}s: {stats.stop_reason}"
            elif overall["error_rate"] > a.max_error_rate:
                reason = f"error rate {overall['error_rate']*100:.1f}% > {a.max_error_rate*100:.0f}%"
            elif overall["p95"] > a.max_p95:
                reason = f"p95 {overall['p95']}s > {a.max_p95}s"
            results.append({"vus": vus, "seconds": a.stage_seconds, "overall": overall, "endpoints": rows,
                            "abort_reason": reason, "samples": stats.samples})
            print(f"   {overall['requests']} req, {overall['rps']} req/s, errors {overall['error_rate']*100:.2f}%, "
                  f"p50 {overall['p50']}s p95 {overall['p95']}s p99 {overall['p99']}s max {overall['max']}s"
                  + (f"  -> STOP: {reason}" if reason else ""), flush=True)
            for n, r in rows.items():
                print(f"     {n:20} {r['requests']:6} req  p95 {r['p95']:6}s  err {r['errors']:4}  {r['codes']}")
            if reason:
                break
    finally:
        if token:
            try:
                httpx.post(a.base + "/api/auth/logout", headers={"Authorization": f"Bearer {token}"}, timeout=15)
            except Exception:
                pass
    out = HERE / "reports"
    out.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    (out / f"load_{stamp}.json").write_text(json.dumps({"meta": meta, "stages": results}, indent=2), encoding="utf-8")
    page = out / f"load_{stamp}.html"
    page.write_text(html_report(meta, results), encoding="utf-8")
    print(f"\nreport: {page}")


if __name__ == "__main__":
    main()
