"""Removes anything the live tests left on production, matched only by the unique test tag.

Run: .venv/Scripts/python cleanup_qa.py   (uses .env.live; prints only QA items, never other users' data)
"""
from conftest import API_BASE, TEST_EMAIL, TEST_PASSWORD, LiveClient

TAG = "qa_live_7f3c9e1a"


def _is_qa(p):
    return any(TAG in str(p.get(k, "")) for k in ("id", "filename", "video_id", "audio_id", "title"))


def cleanup(c: LiveClient) -> list:
    removed = []
    for lst, one in (("/api/projects", "/api/projects/{project_id}"),
                     ("/api/subtitle/projects", "/api/subtitle/projects/{project_id}")):
        r = c.get(lst)
        if r.status_code != 200:
            continue
        for p in [p for p in r.json().get("projects", []) if _is_qa(p)]:
            d = c.request("DELETE", one, params={"project_id": p["id"]}, write=True)
            removed.append((one, p["id"], d.status_code))
            if lst == "/api/projects":
                c.request("DELETE", "/api/cleanup/{audio_id}", params={"audio_id": p["id"]}, write=True)
    for vid in (f"{TAG}_clip", f"{TAG}_clip.wav"):
        d = c.request("POST", "/api/media/discard", json={"video_id": vid}, write=True)
        if d.status_code == 200 and d.json().get("deleted_count"):
            removed.append(("discard", vid, d.json()["deleted_count"]))
    return removed


if __name__ == "__main__":
    c = LiveClient(API_BASE)
    c.token = c.post("/api/auth/login", auth=False, json={"email": TEST_EMAIL, "password": TEST_PASSWORD}).json()["token"]
    try:
        for row in cleanup(c):
            print("removed", row)
        print("done")
    finally:
        c.post("/api/auth/logout")
