import sqlite3

conn = sqlite3.connect("d:/TN/Transcribe/backend/data/transcribe_app.db")
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in c.fetchall()]
print("Tables:", tables)

for t in ["subtitle_generation_runs", "user_media_assets", "audit_logs"]:
    if t in tables:
        c.execute(f"PRAGMA table_info({t})")
        cols = [col[1] for col in c.fetchall()]
        print(f"\n=== {t} (cols: {cols}) ===")
        c.execute(f"SELECT * FROM {t} ORDER BY id DESC LIMIT 3")
        for r in c.fetchall():
            print(dict(zip(cols, r)))
