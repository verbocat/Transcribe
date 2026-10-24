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


def test_rtl_languages_are_offered_and_translatable():
    names = {n: (t, s) for n, t, s in CATALOG}
    for name, code in [("Arabic", "ar"), ("Hebrew", "he"), ("Persian", "fa"), ("Urdu", "ur"), ("Pashto", "ps"), ("Uyghur", "ug"), ("Yiddish", "yi")]:
        assert names[name][0] == code, name


def test_guess_source_lang_reads_rtl_scripts():
    assert guess_source_lang(["مرحبا بالعالم"]) == "ar"
    assert guess_source_lang(["שלום עולם"]) == "he"


def test_ttml_marks_only_rtl_languages():
    from app.export_service import export_netflix_ttml
    ev = [{"start_time": 0, "end_time": 1, "text": "مرحبا"}]
    assert 'tts:direction="rtl"' in export_netflix_ttml(ev, "ar")
    assert 'tts:direction="rtl"' in export_netflix_ttml(ev, "ur")
    assert "tts:direction" not in export_netflix_ttml(ev, "en")
