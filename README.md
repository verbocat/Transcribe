# Lower Third: Transcription & Subtitle Studio

Lower Third is the product name; internal identifiers, API routes, storage keys and the repository name still use the earlier "Karya"/"Transcribe" naming.

A web studio for transcribing speech and building broadcast-grade subtitles, with a focus on Hindi, Hinglish and other Indic languages. Word timings, speaker diarization and audio-event tags come from **ElevenLabs Scribe v2**. A local **Netflix engine** turns those words into subtitle cards that follow the **Netflix Timed Text Style Guide**, and **Google Gemini** is used for optional proofreading, QC fixes and context helpers.

The app has two tools behind one sign-in:

* **Subtitle Studio** (`/subtitle`): generate, edit, QC, translate and export subtitles for a video or audio file.
* **Transcription Studio** (`/transcribe`): segment-style transcription with speaker and gender labels, linting, and CSV/DOCX/XLSX deliverables.

An **Admin dashboard** (`/admin`) lets admins manage users, quotas and audit logs.

For installation, configuration and deployment, see [DEVELOPER.md](DEVELOPER.md).

---

## How subtitle generation works

When you click Generate, the backend streams progress over Server-Sent Events and runs these stages in order:

1. **Media preparation.** FFmpeg reads the frame rate and duration and extracts a 16 kHz mono WAV. Large videos can have their audio extracted in the browser (ffmpeg.wasm) so only the audio is uploaded. Shot changes are detected so cards can snap to scene cuts.
2. **Transcription (ElevenLabs Scribe v2).** The whole file is sent to Scribe in one request, with no fixed-length batching. Scribe returns word-level timestamps, speaker IDs, and (in SDH mode) audio-event tags such as `[laughter]`. Key terms from your Context panel and glossary are passed as Scribe key terms.
3. **Speaker clean-up.** Short diarization "flickers" are smoothed and speakers are relabelled `Speaker 1`, `Speaker 2`, and so on.
4. **Native script enforcement.** When strict native script is on, English loanwords are transliterated into the target script (for example `competition` becomes `कंपटीशन` in Hindi).
5. **Netflix conforming.** The local Netflix engine groups words into cards that respect characters per line, lines per card, reading speed, minimum and maximum duration, frame gaps and shot changes.
6. **Context proofreading (optional).** If you filled in the Context panel and a Gemini key is configured, exact corrections are applied and Gemini proofreads card text against your briefing without changing timings.
7. **QC audit.** Every card is checked for CPS, CPL, line count, duration and gaps, and a compliance score is reported.

The default limits are: 42 characters per line, 2 lines per card, 20 CPS for adult content and 17 CPS for children's content, 0.833 s minimum and 7 s maximum duration. All of them can be changed in the generation settings.

---

## Using Subtitle Studio

### 1. Sign in
Create an account with your email address and verify it from the link you are sent. Login can also ask for a one-time code by email.

### 2. Add your media
Drag a video (`.mp4`, `.mkv`, `.mov`, `.webm`, ...) or audio file (`.wav`, `.mp3`, `.m4a`, ...) into the workspace. The studio prepares the audio, draws the waveform and loads the player. You can also import an existing `.srt` to edit.

### 3. Choose generation settings
* **Language and script:** Auto-detect, Hindi, English, Hinglish, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada and more, with Devanagari, Latin/Hinglish or native-script output.
* **Content type:** Adult (20 CPS) or Children (17 CPS).
* **SDH mode:** include sound descriptions in brackets.
* **Speakers:** auto-detect or a fixed count, with optional speaker tags in the text.
* **Frame rate, CPL, CPS, line and duration limits,** and shot-change snapping.
* **Context panel:** audience, series notes, key terms, character speaking styles and example lines. These steer Scribe key terms and the Gemini proofreading pass.

If no ElevenLabs key is configured on the server, the studio asks for one and stores it in your browser.

### 4. Generate
Click **Generate** (or **Tools → Generate subtitles**). The progress strip shows each stage as it runs, and the subtitle cards appear in the editor when the run completes.

### 5. Review and edit
* Click a card to jump the player to it, and edit text or timings inline. The QC panel updates as you type.
* Drag card edges on the waveform timeline to retime them.
* Use split, merge, re-break and find-and-replace tools from the menu bar or the command palette (`Ctrl+K`).
* The full shortcut list is in **Settings → Shortcuts**.

### 6. Fix timing and QC issues
All of these are in the **Tools** menu:
* **Re-sync timings to speech** re-locks the current cards to Scribe word timings, which is useful after heavy text edits or for an imported `.srt` that drifts. A diff view then shows the old and new timings.
* **Auto-fix QC issues (rules)** applies the Netflix engine's rule-based fixes.
* **Fix QC issues with Gemini** asks Gemini to re-break lines or rephrase cards that still break the rules, without dropping words.
* **Re-break all line breaks** re-runs line breaking on every card.

### 7. Translate (optional)
When the Centroid service is configured on the server, **Tools → Translate subtitles** translates the subtitles into other languages, and **Centroid QC** checks the translations. Each translation becomes a switchable language track in the editor.

### 8. Export
Export as **SRT**, **WebVTT**, **TTML** (Netflix delivery) or plain **TXT**.

---

## Using Transcription Studio

Upload an audio or video file, pick the language and script, and run the transcription. Scribe v2 transcribes the file, the result is split into Karya-compliant segments (20 s maximum, with buffers around speech), speakers are labelled with a gender, and the Karya linter flags punctuation, digit and segment-length issues. Edit segments in the transcript list, then export to Excel, CSV (Karya deliverable columns), Word, SRT, WebVTT, plain text or JSON.
