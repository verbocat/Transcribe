"""
What Lower Third sends to Centroid for translation (speaker, voice gender and language of every line), and the rule
that AI proofreading may only change words ElevenLabs Scribe itself scored as low-confidence.
"""
import asyncio
from types import SimpleNamespace

from app import centroid_client
from app import context_polisher as cp
from app import segment_gender
from app.cue_language import detect_cue_language
from app.netflix_models import SubtitleEvent
from app.subtitle_qc import run_local_qc

EN_IT = ["en", "it"]


# --- T2: language of each line --------------------------------------------------------------------

def test_italian_lines_in_an_english_film_are_detected():
    for line in ("Sto morendo di fame.", "Perché sei tornato così tardi?", "Grazie, mamma.", "Permesso.",
                 "A che pensa la mia fanciulla?", "Vi siete lavati le mani?", "Non vuoi un altro morso?"):
        assert detect_cue_language(line, EN_IT) == "it", line


def test_english_lines_are_never_marked_italian():
    for line in ("You know the rules. You don't go home until you're finished.", "Come here now.", "Wait.",
                 "I have a sick husband", "We're all in the same boat.", "Frieda, wait. We're not allowed to.",
                 "Gentlemen,", "Okay.", "No.", "Stop!", "Leo, Leo.", "Marina."):
        assert detect_cue_language(line, EN_IT) != "it", line


def test_short_or_unclear_lines_get_no_language():
    for line in ("No.", "Hey.", "Mm.", "Oh. Oh.", "Marina.", "[door slams]", "...", "123"):
        assert detect_cue_language(line, EN_IT) is None, line


def test_other_scripts():
    cases = {
        "मैं घर जा रहा हूँ": "hi", "मला माहीत नाही": "mr", "میں گھر جا رہا ہوں": "ur", "من به خانه می‌روم چون": "fa",
        "أنا ذاهب إلى البيت": "ar", "Привіт, як справи?": "uk", "Привет, как дела?": "ru", "こんにちは、元気？": "ja",
        "你好吗": "zh", "안녕하세요": "ko", "สวัสดีครับ": "th", "שלום, מה שלומך?": "he", "Γεια σου, τι κάνεις;": "el",
        "வணக்கம், எப்படி இருக்கீங்க?": "ta", "Je ne sais pas pourquoi.": "fr", "Ich weiß nicht, warum.": "de",
    }
    for text, lang in cases.items():
        assert detect_cue_language(text, ["en"]) == lang, text


# --- T1: speaker and gender per line -----------------------------------------------------------

def test_cue_meta_carries_speaker_gender_and_language():
    e = {"speaker": "Speaker 2", "gender": "Female", "text": "Grazie, mamma."}
    assert centroid_client.cue_meta(e, e["text"], EN_IT) == {"speaker": "Speaker 2", "speaker_gender": "female", "lang": "it"}
    e = {"primary_speaker": "Speaker 1", "gender": "Unknown", "text": "Hey."}
    assert centroid_client.cue_meta(e, e["text"], EN_IT) == {"speaker": "Speaker 1"}


def test_langs_of_request():
    assert centroid_client.langs_of({"source_lang": "en", "target_langs": ["it", "fr"]}) == ["en", "it", "fr"]
    assert centroid_client.langs_of({"source_lang": "en", "target_lang": "it"}) == ["en", "it"]


def test_subtitle_cards_get_voice_gender_without_renaming_speakers(monkeypatch):
    monkeypatch.setattr(segment_gender, "local_gender_probs", lambda path, segs: {0: 0.95, 1: 0.05, 2: 0.9})
    monkeypatch.setattr(segment_gender, "_pitch_probs", lambda path, segs: {})
    events = [SubtitleEvent(id=1, start_time=0.0, end_time=2.0, text="a", speaker="Speaker 1"),
              SubtitleEvent(id=2, start_time=2.5, end_time=4.5, text="b", speaker="Speaker 2"),
              SubtitleEvent(id=3, start_time=5.0, end_time=7.0, text="c", speaker="Speaker 1")]
    assert segment_gender.assign_event_genders("unused.wav", events) == 3
    assert [e.gender for e in events] == ["Female", "Male", "Female"]
    assert [e.speaker for e in events] == ["Speaker 1", "Speaker 2", "Speaker 1"]
    assert events[0].model_dump()["gender"] == "Female"


# --- local QC ------------------------------------------------------------------------------------

def test_local_qc_does_not_flag_a_line_already_in_the_target_language():
    pair = {"start": 0.0, "end": 3.0, "source": "Ciò per cui stiamo lottando è grande.",
            "target": "Ciò per cui stiamo lottando è grande."}
    flagged = [i for i in run_local_qc([pair], "it", "en") if i.get("category") == "untranslated"]
    kept = [i for i in run_local_qc([{**pair, "lang": "it"}], "it", "en") if i.get("category") == "untranslated"]
    assert flagged and not kept


# --- T4: only Scribe's low-confidence words may be changed ---------------------------------------

WORDS = [
    {"text": "Frieda,", "start": 0.1, "end": 0.5, "type": "word", "logprob": -1.2},   # 0.30: unsure
    {"text": " ", "start": 0.5, "end": 0.5, "type": "spacing"},
    {"text": "are", "start": 0.5, "end": 0.7, "type": "word", "logprob": -0.01},
    {"text": "you", "start": 0.7, "end": 0.9, "type": "word", "logprob": -0.02},
    {"text": "hurt?", "start": 0.9, "end": 1.2, "type": "word", "logprob": -0.05},
    {"text": "Fire!", "start": 3.0, "end": 3.4, "type": "word", "logprob": -0.9},     # 0.41: unsure
    {"text": "Wake", "start": 3.5, "end": 3.7, "type": "word"},                       # no score: never unsure
]


def test_unsure_words_come_from_scribe_scores_only():
    assert cp.unsure_words_for_spans([(0.0, 1.3), (2.9, 4.0)], WORDS) == [["Frieda,"], ["Fire!"]]


def test_a_fix_may_only_touch_unsure_words():
    assert cp._only_unsure_changed("Frieda, are you hurt?", "Freeda, are you hurt?", ["Frieda,"])
    assert not cp._only_unsure_changed("Frieda, are you hurt?", "Freeda, did you get hurt?", ["Frieda,"])
    assert not cp._only_unsure_changed("Frieda, are you hurt?", "Freeda, are you hurt?", [])
    assert cp._only_unsure_changed("Fire! Fire!", "Frida! Frida!", ["Fire!"])


def test_proofreading_sends_only_cards_with_unsure_words(monkeypatch):
    prompts = []

    async def fake_gemini(prompt, temperature=0.0):
        prompts.append(prompt)
        return {"fixes": [
            {"id": 1, "text": "Freeda, are you hurt?", "reason": "name"},         # unsure word: accepted
            {"id": 2, "text": "Wake up, please, now.", "reason": "style"},         # card 2 was never sent
            {"id": 3, "text": "Frida! Frida! Get up!", "reason": "misheard"},     # changes a clear word: rejected
        ]}

    monkeypatch.setattr(cp, "_gemini_json", fake_gemini)
    items = [{"id": 1, "text": "Frieda, are you hurt?", "unsure": ["Frieda,"]},
             {"id": 2, "text": "Wake up, please.", "unsure": []},
             {"id": 3, "text": "Fire! Fire! Wake up!", "unsure": ["Fire!"]}]
    fixes = asyncio.run(cp.polish_texts(items, {"notes": "names: Freeda"}, "en"))
    assert [(f["id"], f["after"]) for f in fixes] == [(1, "Freeda, are you hurt?")]
    assert len(prompts) == 1 and '"unsure"' in prompts[0] and '"id": 2' not in prompts[0].split("SUBTITLES TO PROOFREAD:")[1]


def test_proofreading_without_scribe_data_makes_no_ai_call(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("the AI must not be called")

    monkeypatch.setattr(cp, "_gemini_json", boom)
    items = [{"id": 1, "text": "Frieda, are you hurt?"}, {"id": 2, "text": "Wake up."}]
    assert asyncio.run(cp.polish_texts(items, {"notes": "x"}, "en")) == []
