"""
Multi-Language Script Enforcement & Phonetic Transliteration Service
=====================================================================

Ensures that subtitles strictly conform to the native script of the selected target language.
When a non-Latin language (e.g. Hindi, Tamil, Telugu, Bengali, Japanese, Russian, Arabic, etc.)
is chosen, any English or Latin loanwords spoken in the audio (such as "competition", "office",
"doctor", "police", "meeting") are phonetically transliterated into the target language's
authentic native script (e.g., "competition" -> "कंपटीशन" in Hindi Devanagari).

Architecture:
1. Fast offline phonetic mapping table for high-frequency English loanwords in major scripts.
2. AI-powered phonetic transliteration via Gemini for rare, compound, or domain-specific words.
3. Full preservation of word-level audio start/end timestamps and speaker tags.
"""

import re
import json
import logging
from typing import List, Dict, Any, Optional, Set

from app.config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_ASSIST
from app.terminal_logger import log_terminal

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────
# Script Metadata & Language Mapping
# ──────────────────────────────────────────────────────────

LANGUAGE_SCRIPT_MAP = {
    # Indic - Devanagari
    "hindi": {"script": "Devanagari", "native_name": "हिंदी", "code": "hin", "is_latin": False},
    "hi": {"script": "Devanagari", "native_name": "हिंदी", "code": "hin", "is_latin": False},
    "hin": {"script": "Devanagari", "native_name": "हिंदी", "code": "hin", "is_latin": False},
    "hinglish": {"script": "Devanagari", "native_name": "हिंदी (देवनागरी)", "code": "hin", "is_latin": False},
    "marathi": {"script": "Devanagari", "native_name": "मराठी", "code": "mar", "is_latin": False},
    "mr": {"script": "Devanagari", "native_name": "मराठी", "code": "mar", "is_latin": False},
    "mar": {"script": "Devanagari", "native_name": "मराठी", "code": "mar", "is_latin": False},
    "nepali": {"script": "Devanagari", "native_name": "नेपाली", "code": "nep", "is_latin": False},
    "ne": {"script": "Devanagari", "native_name": "नेपाली", "code": "nep", "is_latin": False},

    # Indic - Dravidian & Regional
    "tamil": {"script": "Tamil", "native_name": "தமிழ்", "code": "tam", "is_latin": False},
    "ta": {"script": "Tamil", "native_name": "தமிழ்", "code": "tam", "is_latin": False},
    "tam": {"script": "Tamil", "native_name": "தமிழ்", "code": "tam", "is_latin": False},
    "telugu": {"script": "Telugu", "native_name": "తెలుగు", "code": "tel", "is_latin": False},
    "te": {"script": "Telugu", "native_name": "తెలుగు", "code": "tel", "is_latin": False},
    "tel": {"script": "Telugu", "native_name": "తెలుగు", "code": "tel", "is_latin": False},
    "bengali": {"script": "Bengali", "native_name": "বাংলা", "code": "ben", "is_latin": False},
    "bn": {"script": "Bengali", "native_name": "বাংলা", "code": "ben", "is_latin": False},
    "ben": {"script": "Bengali", "native_name": "বাংলা", "code": "ben", "is_latin": False},
    "gujarati": {"script": "Gujarati", "native_name": "ગુજરાતી", "code": "guj", "is_latin": False},
    "gu": {"script": "Gujarati", "native_name": "ગુજરાતી", "code": "guj", "is_latin": False},
    "guj": {"script": "Gujarati", "native_name": "ગુજરાતી", "code": "guj", "is_latin": False},
    "kannada": {"script": "Kannada", "native_name": "ಕನ್ನಡ", "code": "kan", "is_latin": False},
    "kn": {"script": "Kannada", "native_name": "ಕನ್ನಡ", "code": "kan", "is_latin": False},
    "kan": {"script": "Kannada", "native_name": "ಕನ್ನಡ", "code": "kan", "is_latin": False},
    "malayalam": {"script": "Malayalam", "native_name": "മലയാളം", "code": "mal", "is_latin": False},
    "ml": {"script": "Malayalam", "native_name": "മലയാളം", "code": "mal", "is_latin": False},
    "mal": {"script": "Malayalam", "native_name": "മലയാളം", "code": "mal", "is_latin": False},
    "punjabi": {"script": "Gurmukhi", "native_name": "ਪੰਜਾਬੀ", "code": "pan", "is_latin": False},
    "pa": {"script": "Gurmukhi", "native_name": "ਪੰਜਾਬੀ", "code": "pan", "is_latin": False},
    "pan": {"script": "Gurmukhi", "native_name": "ਪੰਜਾਬੀ", "code": "pan", "is_latin": False},
    "urdu": {"script": "Perso-Arabic", "native_name": "اردو", "code": "urd", "is_latin": False},
    "ur": {"script": "Perso-Arabic", "native_name": "اردو", "code": "urd", "is_latin": False},
    "urd": {"script": "Perso-Arabic", "native_name": "اردو", "code": "urd", "is_latin": False},

    # East Asian (CJK)
    "japanese": {"script": "Katakana/Kanji", "native_name": "日本語 (カタカナ)", "code": "jpn", "is_latin": False},
    "ja": {"script": "Katakana/Kanji", "native_name": "日本語 (カタカナ)", "code": "jpn", "is_latin": False},
    "jpn": {"script": "Katakana/Kanji", "native_name": "日本語 (カタカナ)", "code": "jpn", "is_latin": False},
    "chinese": {"script": "Chinese Simplified", "native_name": "简体中文", "code": "zho", "is_latin": False},
    "zh": {"script": "Chinese Simplified", "native_name": "简体中文", "code": "zho", "is_latin": False},
    "zho": {"script": "Chinese Simplified", "native_name": "简体中文", "code": "zho", "is_latin": False},
    "mandarin": {"script": "Chinese Simplified", "native_name": "简体中文", "code": "zho", "is_latin": False},
    "zht": {"script": "Chinese Traditional", "native_name": "繁體中文", "code": "zho", "is_latin": False},
    "traditional chinese": {"script": "Chinese Traditional", "native_name": "繁體中文", "code": "zho", "is_latin": False},
    "zh-tw": {"script": "Chinese Traditional", "native_name": "繁體中文 (台灣)", "code": "zho", "is_latin": False},
    "zh-hk": {"script": "Chinese Traditional", "native_name": "繁體中文 (香港)", "code": "zho", "is_latin": False},
    "korean": {"script": "Hangul", "native_name": "한국어", "code": "kor", "is_latin": False},
    "ko": {"script": "Hangul", "native_name": "한국어", "code": "kor", "is_latin": False},
    "kor": {"script": "Hangul", "native_name": "한국어", "code": "kor", "is_latin": False},

    # Cyrillic / Slavic
    "russian": {"script": "Cyrillic", "native_name": "Русский", "code": "rus", "is_latin": False},
    "ru": {"script": "Cyrillic", "native_name": "Русский", "code": "rus", "is_latin": False},
    "rus": {"script": "Cyrillic", "native_name": "Русский", "code": "rus", "is_latin": False},
    "ukrainian": {"script": "Cyrillic", "native_name": "Українська", "code": "ukr", "is_latin": False},
    "uk": {"script": "Cyrillic", "native_name": "Українська", "code": "ukr", "is_latin": False},
    "ukr": {"script": "Cyrillic", "native_name": "Українська", "code": "ukr", "is_latin": False},
    "bulgarian": {"script": "Cyrillic", "native_name": "Български", "code": "bul", "is_latin": False},
    "bg": {"script": "Cyrillic", "native_name": "Български", "code": "bul", "is_latin": False},
    "serbian": {"script": "Cyrillic", "native_name": "Српски", "code": "srp", "is_latin": False},
    "sr": {"script": "Cyrillic", "native_name": "Српски", "code": "srp", "is_latin": False},

    # Semitic & Middle Eastern
    "arabic": {"script": "Arabic", "native_name": "العربية", "code": "ara", "is_latin": False},
    "ar": {"script": "Arabic", "native_name": "العربية", "code": "ara", "is_latin": False},
    "ara": {"script": "Arabic", "native_name": "العربية", "code": "ara", "is_latin": False},
    "hebrew": {"script": "Hebrew", "native_name": "עברית", "code": "heb", "is_latin": False},
    "he": {"script": "Hebrew", "native_name": "עברית", "code": "heb", "is_latin": False},
    "heb": {"script": "Hebrew", "native_name": "עברית", "code": "heb", "is_latin": False},
    "persian": {"script": "Perso-Arabic", "native_name": "فارسی", "code": "fas", "is_latin": False},
    "fa": {"script": "Perso-Arabic", "native_name": "فارسی", "code": "fas", "is_latin": False},
    "farsi": {"script": "Perso-Arabic", "native_name": "فارسی", "code": "fas", "is_latin": False},

    # Southeast & Central Asian
    "thai": {"script": "Thai", "native_name": "ไทย", "code": "tha", "is_latin": False},
    "th": {"script": "Thai", "native_name": "ไทย", "code": "tha", "is_latin": False},
    "tha": {"script": "Thai", "native_name": "ไทย", "code": "tha", "is_latin": False},
    "greek": {"script": "Greek", "native_name": "Ελληνικά", "code": "ell", "is_latin": False},
    "el": {"script": "Greek", "native_name": "Ελληνικά", "code": "ell", "is_latin": False},

    # Latin Scripts (no transliteration needed)
    "english": {"script": "Latin", "native_name": "English", "code": "eng", "is_latin": True},
    "en": {"script": "Latin", "native_name": "English", "code": "eng", "is_latin": True},
    "eng": {"script": "Latin", "native_name": "English", "code": "eng", "is_latin": True},
    "spanish": {"script": "Latin", "native_name": "Español", "code": "spa", "is_latin": True},
    "es": {"script": "Latin", "native_name": "Español", "code": "spa", "is_latin": True},
    "french": {"script": "Latin", "native_name": "Français", "code": "fra", "is_latin": True},
    "fr": {"script": "Latin", "native_name": "Français", "code": "fra", "is_latin": True},
    "german": {"script": "Latin", "native_name": "Deutsch", "code": "deu", "is_latin": True},
    "de": {"script": "Latin", "native_name": "Deutsch", "code": "deu", "is_latin": True},
    "italian": {"script": "Latin", "native_name": "Italiano", "code": "ita", "is_latin": True},
    "it": {"script": "Latin", "native_name": "Italiano", "code": "ita", "is_latin": True},
    "portuguese": {"script": "Latin", "native_name": "Português", "code": "por", "is_latin": True},
    "pt": {"script": "Latin", "native_name": "Português", "code": "por", "is_latin": True},
    "turkish": {"script": "Latin", "native_name": "Türkçe", "code": "tur", "is_latin": True},
    "tr": {"script": "Latin", "native_name": "Türkçe", "code": "tur", "is_latin": True},
    "vietnamese": {"script": "Latin", "native_name": "Tiếng Việt", "code": "vie", "is_latin": True},
    "vi": {"script": "Latin", "native_name": "Tiếng Việt", "code": "vie", "is_latin": True},
    "indonesian": {"script": "Latin", "native_name": "Bahasa Indonesia", "code": "ind", "is_latin": True},
    "id": {"script": "Latin", "native_name": "Bahasa Indonesia", "code": "ind", "is_latin": True},
    "polish": {"script": "Latin", "native_name": "Polski", "code": "pol", "is_latin": True},
    "pl": {"script": "Latin", "native_name": "Polski", "code": "pol", "is_latin": True},
    "dutch": {"script": "Latin", "native_name": "Nederlands", "code": "nld", "is_latin": True},
    "nl": {"script": "Latin", "native_name": "Nederlands", "code": "nld", "is_latin": True},
    "swedish": {"script": "Latin", "native_name": "Svenska", "code": "swe", "is_latin": True},
    "sv": {"script": "Latin", "native_name": "Svenska", "code": "swe", "is_latin": True},
}

# ──────────────────────────────────────────────────────────
# Fast Offline Phonetic Dictionary for High-Frequency Words
# ──────────────────────────────────────────────────────────

# Hindi Devanagari common phonetic loanword vocabulary
_OFFLINE_DEVANAGARI_DICT = {
    "competition": "कंपटीशन",
    "competitions": "कंपटीशन्स",
    "office": "ऑफिस",
    "offices": "ऑफिस",
    "doctor": "डॉक्टर",
    "doctors": "डॉक्टर्स",
    "police": "पुलिस",
    "station": "स्टेशन",
    "meeting": "मीटिंग",
    "meetings": "मीटिंग्स",
    "company": "कंपनी",
    "companies": "कंपनियां",
    "school": "स्कूल",
    "schools": "स्कूल",
    "college": "कॉलेज",
    "colleges": "कॉलेजों",
    "hospital": "हॉस्पिटल",
    "hospitals": "हॉस्पिटल्स",
    "mobile": "मोबाइल",
    "mobiles": "मोबाइल",
    "phone": "फोन",
    "phones": "फोन्स",
    "laptop": "लैपटॉप",
    "laptops": "लैपटॉप्स",
    "computer": "कंप्यूटर",
    "computers": "कंप्यूटर्स",
    "internet": "इंटरनेट",
    "video": "वीडियो",
    "videos": "वीडियो",
    "audio": "ऑडियो",
    "audios": "ऑडियो",
    "camera": "कैमरा",
    "cameras": "कैमरे",
    "problem": "प्रॉब्लम",
    "problems": "प्रॉब्लम्स",
    "tension": "टेंशन",
    "sir": "सर",
    "madam": "मैडम",
    "okay": "ओके",
    "ok": "ओके",
    "yes": "यस",
    "no": "नो",
    "sorry": "सॉरी",
    "thanks": "थैंक्स",
    "thank": "थैंक",
    "hello": "हैलो",
    "hi": "हाय",
    "bye": "बाय",
    "good": "गुड",
    "morning": "मॉर्निंग",
    "night": "नाइट",
    "time": "टाइम",
    "money": "मनी",
    "car": "कार",
    "cars": "कारें",
    "bus": "बस",
    "train": "ट्रेन",
    "trains": "ट्रेनें",
    "ticket": "टिकट",
    "tickets": "टिकटें",
    "bank": "बैंक",
    "banks": "बैंकों",
    "account": "अकाउंट",
    "accounts": "अकाउंट्स",
    "card": "कार्ड",
    "cards": "कार्ड्स",
    "number": "नंबर",
    "numbers": "नंबर्स",
    "password": "पासवर्ड",
    "passwords": "पासवर्ड्स",
    "message": "मैसेज",
    "messages": "मैसेजेस",
    "call": "कॉल",
    "calls": "कॉल्स",
    "friend": "फ्रेंड",
    "friends": "फ्रेंड्स",
    "family": "फैमिली",
    "boss": "बॉस",
    "team": "टीम",
    "teams": "टीम्स",
    "project": "प्रोजेक्ट",
    "projects": "प्रोजेक्ट्स",
    "target": "टारगेट",
    "targets": "टारगेट्स",
    "result": "रिजल्ट",
    "results": "रिजल्ट्स",
    "test": "टेस्ट",
    "tests": "टेस्ट्स",
    "exam": "एग्जाम",
    "exams": "एग्जाम्स",
    "class": "क्लास",
    "classes": "क्लासेज",
    "room": "रूम",
    "rooms": "रूम्स",
    "house": "हाउस",
    "market": "मार्केट",
    "mall": "मॉल",
    "hotel": "होटल",
    "hotels": "होटल्स",
    "restaurant": "रेस्टोरेंट",
    "party": "पार्टी",
    "parties": "पार्टियां",
    "club": "क्लब",
    "music": "म्यूजिक",
    "song": "सॉन्ग",
    "songs": "सॉन्ग्स",
    "movie": "मूवी",
    "movies": "मूवीज",
    "film": "फिल्म",
    "films": "फिल्में",
    "game": "गेम",
    "games": "गेम्स",
    "match": "मैच",
    "matches": "मैचेस",
    "player": "प्लेयर",
    "players": "प्लेयर्स",
    "champion": "चैंपियन",
    "winner": "विनर",
    "loser": "लूज़र",
    "challenge": "चैलेंज",
    "opportunity": "अपॉर्चुनिटी",
    "business": "बिजनेस",
    "job": "जॉब",
    "jobs": "जॉब्स",
    "interview": "इंटरव्यू",
    "salary": "सैलरी",
    "system": "सिस्टम",
    "process": "प्रोसेस",
    "idea": "आइडिया",
    "ideas": "आइडियाज",
    "plan": "प्लान",
    "plans": "प्लान्स",
    "action": "एक्शन",
    "decision": "डिसीजन",
    "reason": "रीजन",
    "chance": "चांस",
    "risk": "रिस्क",
    "safe": "सेफ",
    "secure": "सिक्योर",
    "simple": "सिंपल",
    "easy": "इजी",
    "hard": "हार्ड",
    "fast": "फास्ट",
    "slow": "स्लो",
    "start": "स्टार्ट",
    "stop": "स्टॉप",
    "ready": "रेडी",
    "clear": "क्लियर",
    "perfect": "परफेक्ट",
    "great": "ग्रेट",
    "super": "सुपर",
    "best": "बेस्ट",
    "top": "टॉप",
    "next": "नेक्स्ट",
    "first": "फर्स्ट",
    "last": "लास्ट",
    "final": "फाइनल",
    "important": "इंपॉर्टेंट",
    "special": "स्पेशल",
    "normal": "नॉर्मल",
    "real": "रियल",
    "fake": "फेक",
    "true": "ट्रू",
    "false": "फॉल्स",
    "online": "ऑनलाइन",
    "offline": "ऑफलाइन",
    "live": "लाइव",
    "direct": "डायरेक्ट",
    "link": "लिंक",
    "app": "ऐप",
    "apps": "ऐप्स",
    "website": "वेबसाइट",
    "data": "डेटा",
    "file": "फाइल",
    "files": "फाइल्स",
    "folder": "फोल्डर",
    "screen": "स्क्रीन",
    "button": "बटन",
    "level": "लेवल",
    "point": "पॉइंट",
    "points": "पॉइंट्स",
    "score": "स्कोर",
    "side": "साइड",
    "part": "पार्ट",
    "parts": "पार्ट्स",
    "piece": "पीस",
    "check": "चेक",
    "confirm": "कंफर्म",
    "cancel": "कैंसल",
    "update": "अपडेट",
    "download": "डाउनलोड",
    "upload": "अपलोड",
    "share": "शेयर",
    "like": "लाइक",
    "comment": "कमेंट",
    "subscribe": "सब्सक्राइब",
    "channel": "चैनल",
    "show": "शो",
    "episode": "एपिसोड",
    "season": "सीजन",
    "hero": "हीरो",
    "villain": "विलेन",
    "story": "स्टोरी",
    "dialogue": "डायलॉग",
    "scene": "सीन",
    "director": "डायरेक्टर",
    "actor": "एक्टर",
    "actress": "एक्ट्रेस",
    "role": "रोल",
    "character": "कैरेक्टर",
    "line": "लाइन",
    "lines": "लाइंस",
    "page": "पेज",
    "book": "बुक",
    "pen": "पेन",
    "paper": "पेपर",
    "table": "टेबल",
    "chair": "चेयर",
    "door": "डोर",
    "window": "विंडो",
    "road": "रोड",
    "street": "स्ट्रीट",
    "city": "सिटी",
    "state": "स्टेट",
    "country": "कंट्री",
    "world": "वर्ल्ड",
    "life": "लाइफ",
    "love": "लव",
    "hate": "हेट",
    "mind": "माइंड",
    "heart": "हार्ट",
    "body": "बॉडी",
    "face": "फेस",
    "hand": "हैंड",
    "food": "फूड",
    "water": "वॉटर",
    "tea": "टी",
    "coffee": "कॉफी",
    "cup": "कप",
    "glass": "ग्लास",
    "plate": "प्लेट",
    "bottle": "बोतल",
    "bag": "बैग",
    "box": "बॉक्स",
    "pack": "पैक",
    "packet": "पैकेट",
    "pocket": "पॉकेट",
    "shirt": "शर्ट",
    "pant": "पैंट",
    "dress": "ड्रेस",
    "shoe": "शू",
    "shoes": "शूज",
    "watch": "वॉच",
    "light": "लाइट",
    "fan": "फैन",
    "switch": "स्विच",
    "key": "की",
    "lock": "लॉक",
}

# Tamil common phonetic loanword vocabulary
_OFFLINE_TAMIL_DICT = {
    "competition": "காம்படிஷன்",
    "office": "ஆபீஸ்",
    "doctor": "டாக்டர்",
    "hospital": "ஹாஸ்பிடல்",
    "police": "போலீஸ்",
    "station": "ஸ்டேஷன்",
    "meeting": "மீட்டிங்",
    "company": "கம்பெனி",
    "school": "ஸ்கூல்",
    "college": "காலேஜ்",
    "mobile": "மொபைல்",
    "phone": "போன்",
    "laptop": "லேப்டாப்",
    "computer": "கம்ப்யூட்டர்",
    "camera": "கேமரா",
    "video": "வீடியோ",
    "audio": "ஆடியோ",
    "problem": "ப்ராப்ளம்",
    "sir": "சார்",
    "madam": "மேடம்",
    "ok": "ஓகே",
    "okay": "ஓகே",
    "yes": "யெஸ்",
    "no": "நோ",
    "sorry": "ஸாரி",
    "thanks": "தேங்க்ஸ்",
    "hello": "ஹலோ",
    "hi": "ஹாய்",
    "bye": "பாய்",
    "project": "ப்ராஜெக்ட்",
    "team": "டீம்",
    "job": "ஜாப்",
    "salary": "சேலரி",
    "interview": "இன்டர்வியூ",
    "car": "கார்",
    "bus": "பஸ்",
    "train": "ட்ரெயின்",
    "ticket": "டிக்கெட்",
    "bank": "பேங்க்",
    "card": "கார்ட்",
    "number": "நம்பர்",
    "password": "பாஸ்வேர்ட்",
    "message": "மெசேஜ்",
    "call": "கால்",
    "movie": "மூவி",
    "game": "கேம்",
    "app": "ஆப்",
    "link": "லிங்க்",
    "channel": "சேனல்",
    "system": "சிஸ்டம்",
    "test": "டெஸ்ட்",
    "result": "ரிசல்ட்",
    "idea": "ஐடியா",
    "plan": "பிளான்",
    "check": "செக்",
    "live": "லைவ்",
    "online": "ஆன்லைன்",
    "class": "கிளாஸ்",
    "time": "டைம்",
    "super": "சூப்பர்",
    "best": "பெஸ்ட்",
}

# Telugu common phonetic loanword vocabulary
_OFFLINE_TELUGU_DICT = {
    "competition": "కాంపిటీషన్",
    "office": "ఆఫీస్",
    "doctor": "డాక్టర్",
    "hospital": "హాస్పిటల్",
    "police": "పోలీస్",
    "station": "స్టేషన్",
    "meeting": "మీటింగ్",
    "company": "కంపెనీ",
    "school": "స్కూల్",
    "college": "కాలేజ్",
    "mobile": "మొబైల్",
    "phone": "ఫోన్",
    "laptop": "ల్యాప్‌టాప్",
    "computer": "కంప్యూటర్",
    "camera": "కెమెరా",
    "video": "వీడియో",
    "audio": "ఆడియో",
    "problem": "ప్రాబ్లమ్",
    "sir": "సార్",
    "madam": "మేడమ్",
    "ok": "ఓకే",
    "okay": "ఓకే",
    "yes": "యెస్",
    "no": "నో",
    "sorry": "సారీ",
    "thanks": "థాంక్స్",
    "hello": "హలో",
    "hi": "హాయ్",
    "bye": "బాయ్",
    "project": "ప్రాజెక్ట్",
    "team": "టీమ్",
    "job": "జాబ్",
    "salary": "శాలరీ",
    "interview": "ఇంటర్వ్యూ",
    "car": "కారు",
    "bus": "బస్సు",
    "train": "ట్రైన్",
    "ticket": "టికెట్",
    "bank": "బ్యాంక్",
    "card": "కార్డు",
    "number": "నంబర్",
    "password": "పాస్‌వర్డ్",
    "message": "మెసేజ్",
    "call": "కాల్",
    "movie": "మూవీ",
    "game": "గేమ్",
    "app": "యాప్",
    "link": "లింక్",
    "channel": "ఛానల్",
    "system": "సిస్టమ్",
    "test": "టెస్ట్",
    "result": "రిజల్ట్",
    "idea": "ఐడియా",
    "plan": "ప్లాన్",
    "check": "చెక్",
    "live": "లైవ్",
    "online": "ఆన్‌లైన్",
    "class": "క్లాస్",
    "time": "టైమ్",
    "super": "సూపర్",
    "best": "బెస్ట్",
}

# Bengali common phonetic loanword vocabulary
_OFFLINE_BENGALI_DICT = {
    "competition": "কম্পিটিশন",
    "office": "অফিস",
    "doctor": "ডাক্তার",
    "hospital": "হাসপাতাল",
    "police": "পুলিশ",
    "station": "স্টেশন",
    "meeting": "মিটিং",
    "company": "কোম্পানি",
    "school": "স্কুল",
    "college": "কলেজ",
    "mobile": "মোবাইল",
    "phone": "ফোন",
    "laptop": "ল্যাপটপ",
    "computer": "কম্পিউটার",
    "camera": "ক্যামেরা",
    "video": "ভিডিও",
    "audio": "অডিও",
    "problem": "প্রবলেম",
    "sir": "স্যার",
    "madam": "ম্যাডাম",
    "ok": "ওকে",
    "okay": "ওকে",
    "yes": "ইয়েস",
    "no": "নো",
    "sorry": "সরি",
    "thanks": "থ্যাঙ্কস",
    "hello": "হ্যালো",
    "hi": "হাই",
    "bye": "বাই",
    "project": "প্রজেক্ট",
    "team": "টিম",
    "job": "জব",
    "salary": "স্যালারি",
    "interview": "ইন্টারভিউ",
    "car": "কার",
    "bus": "বাস",
    "train": "ট্রেন",
    "ticket": "টিকিট",
    "bank": "ব্যাংক",
    "card": "কার্ড",
    "number": "নম্বর",
    "password": "পাসওয়ার্ড",
    "message": "মেসেজ",
    "call": "কল",
    "movie": "মুভি",
    "game": "গেম",
    "app": "অ্যাপ",
    "link": "লিঙ্ক",
    "channel": "চ্যানেল",
    "system": "সিস্টেম",
    "test": "টেস্ট",
    "result": "রেজাল্ট",
    "idea": "আইডিয়া",
    "plan": "প্ল্যান",
    "check": "চেক",
    "live": "লাইভ",
    "online": "অনলাইন",
    "class": "ক্লাস",
    "time": "টাইম",
    "super": "সুপার",
    "best": "বেস্ট",
}

# Japanese Katakana common phonetic loanword vocabulary
_OFFLINE_JAPANESE_DICT = {
    "competition": "コンペティション",
    "office": "オフィス",
    "doctor": "ドクター",
    "police": "ポリス",
    "station": "ステーション",
    "meeting": "ミーティング",
    "company": "カンパニー",
    "school": "スクール",
    "mobile": "モバイル",
    "laptop": "ラップトップ",
    "computer": "コンピューター",
    "camera": "カメラ",
    "video": "ビデオ",
    "audio": "オーディオ",
    "problem": "プロブレム",
    "ok": "オーケー",
    "okay": "オーケー",
    "project": "プロジェクト",
    "team": "チーム",
    "card": "カード",
    "message": "メッセージ",
    "call": "コール",
    "movie": "ムービー",
    "game": "ゲーム",
    "app": "アプリ",
    "link": "リンク",
    "channel": "チャンネル",
    "system": "システム",
    "test": "テスト",
    "result": "リザルト",
    "idea": "アイデア",
    "plan": "プラン",
    "check": "チェック",
    "live": "ライブ",
    "online": "オンライン",
    "class": "クラス",
    "time": "タイム",
    "super": "スーパー",
    "best": "ベスト",
}

# Russian Cyrillic common phonetic loanword vocabulary
_OFFLINE_RUSSIAN_DICT = {
    "competition": "компетишн",
    "office": "офис",
    "doctor": "доктор",
    "police": "полиция",
    "station": "станция",
    "meeting": "митинг",
    "company": "компания",
    "mobile": "мобильный",
    "laptop": "ноутбук",
    "computer": "компьютер",
    "camera": "камера",
    "video": "видео",
    "audio": "аудио",
    "problem": "проблема",
    "ok": "окей",
    "okay": "окей",
    "project": "проект",
    "team": "команда",
    "card": "карта",
    "message": "сообщение",
    "movie": "фильм",
    "game": "игра",
    "app": "приложение",
    "link": "ссылка",
    "channel": "канал",
    "system": "система",
    "test": "тест",
    "result": "результат",
    "idea": "идея",
    "plan": "план",
    "check": "чек",
    "live": "лайв",
    "online": "онлайн",
    "class": "класс",
    "time": "тайм",
    "super": "супер",
    "best": "бест",
}

# Arabic common phonetic loanword vocabulary
_OFFLINE_ARABIC_DICT = {
    "competition": "كومبيتيشن",
    "office": "أوفيس",
    "doctor": "دكتور",
    "police": "بوليس",
    "station": "ستيشن",
    "meeting": "ميتينج",
    "company": "كومباني",
    "mobile": "موبايل",
    "laptop": "لابتوب",
    "computer": "كمبيوتر",
    "camera": "كاميرا",
    "video": "فيديو",
    "audio": "أوديو",
    "problem": "بروبلم",
    "ok": "أوكي",
    "okay": "أوكي",
    "project": "بروجكت",
    "team": "تيم",
    "card": "كارد",
    "message": "مسج",
    "movie": "فيلم",
    "game": "جيم",
    "app": "تطبيق",
    "link": "لينك",
    "channel": "قناة",
    "system": "سيستم",
    "test": "تيست",
    "result": "ريزلت",
    "idea": "فكرة",
    "plan": "بلان",
    "check": "تشيك",
    "live": "لايف",
    "online": "أونلاين",
    "class": "كلاس",
    "time": "تايم",
    "super": "سوبر",
    "best": "بيست",
}

# Regex to detect Latin words that need transliteration
_LATIN_WORD_RE = re.compile(r'^[A-Za-z]+(?:\'[A-Za-z]+)?$')


def get_offline_dict_for_script(target_script: str) -> Dict[str, str]:
    """Return offline phonetic dictionary corresponding to target script."""
    ts = str(target_script).lower()
    if "devanagari" in ts:
        return _OFFLINE_DEVANAGARI_DICT
    if "tamil" in ts:
        return _OFFLINE_TAMIL_DICT
    if "telugu" in ts:
        return _OFFLINE_TELUGU_DICT
    if "bengali" in ts:
        return _OFFLINE_BENGALI_DICT
    if "katakana" in ts or "japanese" in ts:
        return _OFFLINE_JAPANESE_DICT
    if "cyrillic" in ts or "russian" in ts:
        return _OFFLINE_RUSSIAN_DICT
    if "arabic" in ts:
        return _OFFLINE_ARABIC_DICT
    return {}


def get_language_script_info(
    language: Optional[str],
    script_override: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Resolve language to its script specification and whether it is Latin."""
    if script_override:
        sc = str(script_override).strip().lower()
        if sc == "latin":
            return {"script": "Latin", "native_name": "Latin", "code": "lat", "is_latin": True}
        if sc == "devanagari":
            return {"script": "Devanagari", "native_name": "हिंदी (देवनागरी)", "code": "hin", "is_latin": False}

    if not language:
        return None
    cleaned = str(language).strip().lower()
    if cleaned == "hinglish":
        # Hinglish specifically requests Latin script for Hindi
        if script_override != "devanagari":
            return {"script": "Latin", "native_name": "Hinglish (Latin)", "code": "hin", "is_latin": True}
    return LANGUAGE_SCRIPT_MAP.get(cleaned)


async def transliterate_tokens_with_gemini(
    words_to_transliterate: List[str],
    target_language: str,
    target_script: str
) -> Dict[str, str]:
    """
    Calls Gemini API to phonetically transliterate a list of Latin/English words
    into the authentic phonetic script of the target language.
    """
    if not words_to_transliterate:
        return {}

    api_key = GEMINI_API_KEY
    if not api_key:
        logger.warning("[Transliteration] GEMINI_API_KEY missing; skipping Gemini phonetic pass.")
        return {}

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        prompt = f"""You are a professional broadcast linguist specializing in phonetic transliteration for subtitles.
Task: Transliterate the following list of English/Latin words phonetically into the native {target_script} script of {target_language}.

STRICT RULES:
1. Do NOT translate the semantic meaning. Only transliterate the PHONETIC SOUND as spoken naturally in colloquial {target_language}.
   Examples across major world scripts:
   - Hindi / Marathi / Nepali (Devanagari): "competition" -> "कंपटीशन", "office" -> "ऑफिस", "doctor" -> "डॉक्टर"
   - Tamil: "competition" -> "காம்படிஷன்", "office" -> "ஆபீஸ்", "doctor" -> "டாக்டர்"
   - Telugu: "competition" -> "కాంపిటీషన్", "office" -> "ఆఫీస్", "doctor" -> "డాక్టర్"
   - Bengali: "competition" -> "কম্পিটিশন", "office" -> "অফিস", "doctor" -> "ডাক্তার"
   - Gujarati: "competition" -> "કોમ્પિટિશન", "office" -> "ઓફિસ", "doctor" -> "ડોક્ટર"
   - Kannada: "competition" -> "ಕಾಂಪಿಟೇಷನ್", "office" -> "ಆಫೀಸ್", "doctor" -> "ಡಾಕ್ಟರ್"
   - Malayalam: "competition" -> "കോമ്പറ്റീഷൻ", "office" -> "ഓഫീസ്", "doctor" -> "ഡോക്ടർ"
   - Punjabi (Gurmukhi): "competition" -> "ਕੰਪੀਟੀਸ਼ਨ", "office" -> "ਦਫ਼ਤਰ" / "ਆਫਿਸ", "doctor" -> "ਡਾਕਟਰ"
   - Japanese (Katakana): "competition" -> "コンペティション", "office" -> "オフィス"
   - Korean (Hangul): "competition" -> "컴페티션", "office" -> "오피스"
   - Chinese: "competition" -> "康佩蒂申" / "竞赛", "office" -> "办公室"
   - Russian / Ukrainian (Cyrillic): "competition" -> "компетишн", "office" -> "офис"
   - Arabic: "competition" -> "كومبيتيشن", "office" -> "أوفيس"
   - Hebrew: "competition" -> "קומפטישן", "office" -> "אופיס"
   - Thai: "competition" -> "คอมเพทิชัน", "office" -> "ออฟฟิศ"
2. Output strictly a JSON dictionary mapping the exact lowercase English word to its phonetic {target_script} spelling.
3. No commentary, markdown formatting or text outside the JSON object.

Words to transliterate:
{json.dumps(words_to_transliterate, ensure_ascii=False)}
"""

        model_name = GEMINI_MODEL or "gemini-3.8-flash"
        from app.gemini_util import generate_async
        response = await generate_async(
            client, model_name, prompt,
            types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json"),
        )

        resp_text = (response.text or "").strip()
        if not resp_text:
            return {}

        result = json.loads(resp_text)
        if isinstance(result, dict):
            # Normalize keys to lower
            return {k.lower(): str(v) for k, v in result.items() if v}
        return {}

    except Exception as exc:
        logger.error(f"[Transliteration] Gemini transliteration error: {exc}")
        return {}


async def enforce_native_script_for_words(
    words: List[Dict[str, Any]],
    target_language: Optional[str] = "hindi",
    target_script_override: Optional[str] = "auto",
    enable_strict_script: bool = True
) -> List[Dict[str, Any]]:
    """
    Scans word tokens for Latin/English loan words and transliterates them
    into the native script of target_language.

    Returns the updated words list with timing and metadata completely preserved.
    """
    if not words or not enable_strict_script:
        return words

    script_info = get_language_script_info(target_language, script_override=target_script_override)
    if not script_info or script_info.get("is_latin", False):
        # Target language is already Latin-based (English, Spanish, etc.) - no transliteration needed
        return words

    target_script = script_info["script"]
    native_lang_name = script_info["native_name"]
    offline_dict = get_offline_dict_for_script(target_script)

    # Step 1: Identify all Latin words and punctuation
    missing_words_set: Set[str] = set()
    transliteration_map: Dict[str, str] = {}

    for w in words:
        raw_text = str(w.get("text", "")).strip()
        if not raw_text or w.get("type") == "audio_event":
            continue

        # Strip surrounding punctuation to test word root
        clean_word = re.sub(r'^[^\w]+|[^\w]+$', '', raw_text)
        if _LATIN_WORD_RE.match(clean_word):
            lower_word = clean_word.lower()

            # Check offline dictionary first
            if lower_word in offline_dict:
                transliteration_map[lower_word] = offline_dict[lower_word]
            else:
                missing_words_set.add(lower_word)

    # Step 2: offline phonetic transliteration (CMU pronouncing dictionary -> native script). No API, no cost.
    if missing_words_set:
        from app.phonetic_translit import phonetic_transliterate
        still_missing: Set[str] = set()
        for word in missing_words_set:
            phonetic = phonetic_transliterate(word, target_script, allow_guess=False)
            if phonetic:
                transliteration_map[word] = phonetic
            else:
                still_missing.add(word)
        log_terminal(
            "TRANSLITERATION",
            f"Offline phonetics transliterated {len(missing_words_set) - len(still_missing)} of {len(missing_words_set)} loanwords into {target_script}."
        )
        missing_words_set = still_missing

    # Step 3: words unknown to the dictionary (rare names, slang). Gemini only if explicitly enabled.
    if missing_words_set and GEMINI_ASSIST:
        log_terminal(
            "TRANSLITERATION",
            f"Calling Gemini API to phonetically transliterate {len(missing_words_set)} unknown Latin words into {target_script} ({native_lang_name})..."
        )
        gemini_results = await transliterate_tokens_with_gemini(
            list(missing_words_set),
            target_language=script_info["native_name"],
            target_script=target_script
        )
        transliteration_map.update(gemini_results)
        missing_words_set = {w for w in missing_words_set if w not in gemini_results}

    # Step 4: whatever is left gets a letter-to-sound guess, so the output is always in the target script
    if missing_words_set:
        from app.phonetic_translit import phonetic_transliterate
        for word in missing_words_set:
            guess = phonetic_transliterate(word, target_script, allow_guess=True)
            if guess:
                transliteration_map[word] = guess

    if not transliteration_map:
        log_terminal("TRANSLITERATION", "No Latin loanwords needed transliteration. All tokens comply with target script.")
        return words

    # Step 3: Apply transliterations preserving surrounding punctuation
    transliterated_count = 0
    updated_words = []

    for w in words:
        w_copy = dict(w)
        raw_text = str(w_copy.get("text", ""))

        if not raw_text or w_copy.get("type") == "audio_event":
            updated_words.append(w_copy)
            continue

        # Extract leading and trailing punctuation (e.g., '"competition,"' -> '"', 'competition', ',"')
        m = re.match(r'^([^\w]*)([\w\']+)([^\w]*)$', raw_text)
        if m:
            prefix, core_word, suffix = m.groups()
            lower_core = core_word.lower()
            if lower_core in transliteration_map:
                transliterated_word = transliteration_map[lower_core]
                w_copy["text"] = f"{prefix}{transliterated_word}{suffix}"
                transliterated_count += 1
        
        updated_words.append(w_copy)

    sample_mappings = list(transliteration_map.items())[:6]
    log_terminal(
        "TRANSLITERATION",
        f"[OK] Successfully transliterated {transliterated_count} words into native {target_script} ({native_lang_name}). Samples: {sample_mappings}"
    )
    return updated_words
