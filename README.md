# Subtitle Studio & AI Audio Transcription Pipeline

An AI-powered, broadcast-grade subtitle generation, acoustic alignment, and quality-control studio. Built for creators, translators, and post-production teams, the studio combines **Google Gemini 2.5 Flash/Pro Multimodal AI**, **OpenAI Whisper**, **Silero Neural VAD**, and **FFmpeg** to produce 100% verified, broadcast-compliant subtitles conforming to the **Netflix Timed Text Style Guide**.

---

## What This Tool Is

Subtitle Studio is an end-to-end web workstation designed to solve the hardest problems in automated subtitling and speech transcription:

1. **Eliminating Missing & Truncated Dialogues:**
   * Traditional speech-to-text engines drop speech during rapid conversations, interruptions, heated arguments, and loud background music or sound effects.
   * Subtitle Studio uses Gemini 2.5 multimodal audio perception with custom prompt constraints, enabling it to transcribe verbatim dialogue even through loud gunfire, explosions, vehicle noise, and background scores.

2. **Multi-Speaker & Overlapping Speech Support:**
   * Simultaneous shouting, crosstalk, and team callouts are formatted using international dual-speaker hyphen standards:
     ```text
     - [Player 1]: Cover de bhai!
     - [Player 2]: Right pe banda hai!
     ```
   * Neither speaker is dropped or silenced.

3. **Intelligent 90-Second Dialogue-Aware Batching:**
   * Instead of slicing videos blindly at fixed seconds (which cuts words in half), the studio uses **Silero Neural Voice Activity Detection (VAD)** to identify true dialogue pauses ($\ge 1.2–2.0\text{s}$ silence) around ~90 seconds.
   * Every batch ends on a clean conversational turn with zero word clippings.

4. **Hardware-Safe Sequential Processing:**
   * Batches are processed strictly one at a time (**Gemini AI $\rightarrow$ Whisper Alignment $\rightarrow$ Gemini QC $\rightarrow$ UI Emit $\rightarrow$ Next Batch**).
   * Prevents GPU/CPU memory thrashing and API rate-limit crashes while maintaining conversational context across batch boundaries.

5. **Dynamic Audio Range Normalization (`dynaudnorm`):**
   * Built-in FFmpeg dynamic normalization automatically balances quiet in-game Discord or teammate voice-chat by up to $+20\text{ dB}$ to match the primary streamer’s microphone before audio reaches the AI models.

6. **Netflix Timed Text Style Guide Enforcement:**
   * Automatically lints and enforces 20+ broadcast rules:
     * **Reading Speed (CPS):** Target $\le 20\text{ CPS}$ (adult) / $\le 17\text{ CPS}$ (children).
     * **Line Length (CPL):** Maximum 42 characters per line (Latin/Indic).
     * **Line Limits:** Exactly 1 or 2 lines per subtitle event (never 3).
     * **Minimum Duration:** $0.833\text{ seconds}$ (20 frames @ 24fps).
     * **Maximum Duration:** $7.0\text{ seconds}$.
     * **Gap Management:** Minimum 2-frame gap between consecutive subtitles; 3–11 frame gaps are automatically chained.
     * **Shot Change Snapping:** Snaps subtitles to video scene transitions.
     * **Hindi Postposition Protection:** Keeps postpositions (`ने`, `को`, `से`, `का`, `के`, `की`, `में`, `पर`, `पे`) bonded to their preceding noun.

7. **Closed-Loop Acoustic Synchronization (Whisper + VAD + DTW):**
   * Snaps subtitle start and end timestamps to the millisecond acoustic onset and offset of spoken vocal cords using monotonic Dynamic Time Warping (DTW).

---

## How to Use This Tool (Step-by-Step)

### Step 1: Launch and Upload Media
1. Open the studio in your browser (default: `http://localhost:5173`).
2. Drag and drop your **video file** (`.mp4`, `.mkv`, `.mov`, `.webm`) or **audio file** (`.wav`, `.mp3`, `.m4a`) into the upload dropzone, or click **Browse Files**.
3. The studio automatically extracts the audio track, calculates waveform peaks, and initializes the interactive video player.

---

### Step 2: Configure Generation Settings
In the top control bar and settings drawer, select your preferences:
* **Spoken Language:** Choose `Auto-Detect`, `Hindi`, `English`, `Hinglish`, `Tamil`, `Telugu`, `Bengali`, `Marathi`, `Gujarati`, `Kannada`, etc.
* **Target Script:** 
  * `Devanagari` (Pure Hindi script, phonetic transliteration of English words).
  * `Latin / Hinglish` (Conversational Hindi written in the English alphabet).
  * `Latin` (Standard English).
* **Content Type:** `Adult` (20 CPS limit) or `Children` (17 CPS limit).
* **SDH Mode (Subtitles for Deaf & Hard of Hearing):** Toggle ON to include audible sound descriptions in brackets (e.g. `[gunfire]`, `[laughter]`).
* **Frame Rate:** Set your project frame rate (e.g. `24.0`, `25.0`, `29.97`, `30.0`, `60.0 fps`).

---

### Step 3: Start Generation
1. Click the **Auto-Generate** button in the top navigation bar.
2. The pipeline starts streaming batches in real-time:
   * **Stage 1 (Gemini AI):** Transcribes verbatim speech and assigns speaker labels.
   * **Stage 2 (Whisper DTW):** Aligns word timestamps acoustically to the audio waveform.
   * **Stage 3 (Netflix QC):** Audits and auto-corrects reading speeds, line lengths, and gap chaining.
3. Subtitle events stream directly into the editor table and timeline as each batch completes.

---

### Step 4: Review and Edit in the Studio
* **Interactive Table View:** Click any subtitle card to jump the video/audio player directly to that moment.
* **Live Editing:** Edit subtitle text, start time, or end time directly in the inputs. The linter re-evaluates CPS and CPL instantly.
* **Timeline Trimming:** Drag the start or end handles of any subtitle block on the timeline to fine-tune timings.
* **Keyboard Shortcuts:**
  * `Space`: Play / Pause playback.
  * `Ctrl + Z` / `Ctrl + Y`: Undo / Redo edits.
  * `Delete` / `Backspace`: Delete selected subtitle event(s).
  * `Ctrl + A`: Select all subtitle events.
  * `[` / `]`: Seek backward / forward 1 second.
* **Split & Merge:**
  * **Split:** Click the split icon to divide a long subtitle at the current playhead position.
  * **Merge:** Click the merge icon to combine a subtitle with the next consecutive event.

---

### Step 5: Sync Audio (Acoustic Alignment)
If you made manual text edits, added new subtitles, or imported an external `.srt` file that has timing drift:
1. Click the **Sync Audio** button (volume icon) in the top toolbar.
2. The backend runs Whisper and Silero VAD to acoustically re-align the subtitles to the spoken audio.
3. A **Diff Modal** opens showing a side-by-side comparison of previous vs. newly synchronized timestamps. Click **Accept Changes** to apply.

---

### Step 6: 1-Click AI Auto-Fix (Gemini Self-Correction)
If the Netflix QC panel flags warnings (e.g., reading speed over 20 CPS or a line exceeding 42 characters):
1. Click **Auto-Fix** in the top bar or QC panel.
2. The system executes a Gemini self-correction pass that re-breaks lines at grammatical boundaries or expands durations into adjacent pauses without deleting words.

---

### Step 7: Export Subtitles
1. Click the **Export** button in the top right corner.
2. Choose your desired format:
   * **SRT (`.srt`):** Universal subtitle format for YouTube, VLC, Premiere Pro, and DaVinci Resolve.
   * **VTT (`.vtt`):** Web Video Text Tracks for HTML5 web players.
   * **TTML (`.ttml` / `.xml`):** Netflix / SMPTE broadcast delivery format.
   * **CSV / Excel (`.xlsx`):** Tabular data containing event IDs, start/end timestamps, speakers, text, and CPS stats.
   * **TXT:** Clean plain text script.
3. The file downloads immediately to your computer.
