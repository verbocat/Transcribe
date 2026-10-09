import json
from pathlib import Path

from app.language_catalog import CATALOG, guess_source_lang
from app.elevenlabs_service import resolve_language_code

JSON = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "languages.json"


def test_frontend_list_matches_backend():
    front = [(d["name"], d["translate"], d["scribe"]) for d in json.loads(JSON.read_text(encoding="utf-8"))]
    assert front == [tuple(r) for r in CATALOG]


def test_every_transcription_language_resolves_to_its_scribe_code():
    for name, short, scribe in CATALOG:
        if scribe:
            assert resolve_language_code(name) == scribe, name
            assert resolve_language_code(scribe) == scribe
            if short:
                assert resolve_language_code(short) == scribe, short


def test_auto_detect_means_no_language():
    assert resolve_language_code("Auto-Detect") is None


def test_guess_source_lang():
    assert guess_source_lang(["नमस्ते दोस्तों"]) == "hi"
    assert guess_source_lang(["வணக்கம்"]) == "ta"
    assert guess_source_lang(["hello there"]) == "en"
    assert guess_source_lang(["hello"], "fr") == "fr"
