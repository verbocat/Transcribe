"""Offline English -> Devanagari transliteration (app/phonetic_translit.py)."""
from app.phonetic_translit import phonetic_transliterate as t

# Standard Hindi spellings the rules and lexicon are expected to reproduce exactly
KNOWN = {
    "feet": "फीट", "support": "सपोर्ट", "ceiling": "सीलिंग", "hanging": "हैंगिंग", "court": "कोर्ट", "notice": "नोटिस",
    "order": "ऑर्डर", "viral": "वायरल", "please": "प्लीज़", "young": "यंग", "die": "डाई", "dead": "डेड", "mean": "मीन",
    "number": "नंबर", "friend": "फ्रेंड", "doctor": "डॉक्टर", "station": "स्टेशन", "hospital": "हॉस्पिटल",
    "problem": "प्रॉब्लम", "sorry": "सॉरी", "office": "ऑफिस", "team": "टीम", "phone": "फोन", "school": "स्कूल",
    "okay": "ओके", "promise": "प्रॉमिस", "photo": "फोटो", "car": "कार", "bus": "बस", "time": "टाइम",
    "bulldozer": "बुलडोज़र", "video": "वीडियो", "police": "पुलिस", "mobile": "मोबाइल",
}

# Words never used while writing the rules. The bar is deliberately modest: spelling conventions vary.
FRESH = {
    "dollar": "डॉलर", "coffee": "कॉफी", "pencil": "पेंसिल", "monitor": "मॉनिटर", "remote": "रिमोट", "agent": "एजेंट",
    "profit": "प्रॉफिट", "loan": "लोन", "credit": "क्रेडिट", "tension": "टेंशन", "update": "अपडेट",
    "download": "डाउनलोड", "online": "ऑनलाइन", "cancel": "कैंसल", "nurse": "नर्स", "bed": "बेड",
    "injection": "इंजेक्शन", "operation": "ऑपरेशन", "medicine": "मेडिसिन", "scooter": "स्कूटर", "lift": "लिफ्ट",
    "gas": "गैस", "company": "कंपनी", "shooting": "शूटिंग", "scene": "सीन", "paper": "पेपर",
    "interview": "इंटरव्यू", "project": "प्रोजेक्ट", "register": "रजिस्टर", "report": "रिपोर्ट", "client": "क्लाइंट",
    "budget": "बजट", "message": "मैसेज", "confirm": "कन्फर्म", "tablet": "टैबलेट", "ward": "वार्ड",
    "plastic": "प्लास्टिक", "factory": "फैक्ट्री", "director": "डायरेक्टर", "producer": "प्रोड्यूसर",
}


def test_known_spellings():
    wrong = {w: (t(w), want) for w, want in KNOWN.items() if t(w) != want}
    assert not wrong, wrong


def test_fresh_words_stay_above_floor():
    hits = sum(t(w) == want for w, want in FRESH.items())
    assert hits / len(FRESH) >= 0.60, f"{hits}/{len(FRESH)} exact"


def test_output_is_always_native_script():
    for word in ["zorbnik", "tulsifans", "xylophone", "bulldozer"]:
        out = t(word)
        assert out and all("ऀ" <= ch <= "ॿ" for ch in out), (word, out)


def test_other_scripts_use_their_own_block():
    assert all("ঀ" <= c <= "৿" for c in t("support", "Bengali"))
    assert all("ఀ" <= c <= "౿" for c in t("support", "Telugu"))
    assert all("஀" <= c <= "௿" for c in t("support", "Tamil"))
