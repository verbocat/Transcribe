import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, RotateCcw, Sparkles, Sliders, ShieldCheck, Check, Globe, FileUp, Upload } from 'lucide-react';
import { setCustomApiBase, cleanUrl } from '../../config';

export default function SubtitleSettingsModal({
  isOpen,
  onClose,
  isDark = true,
  cplLimit = 42,
  setCplLimit,
  cpsLimit = 20,
  setCpsLimit,
  maxLines = 2,
  setMaxLines,
  minDuration = 0.833,
  setMinDuration,
  maxDuration = 7.0,
  setMaxDuration,
  frameRate = 24.0,
  setFrameRate,
  language = 'en',
  setLanguage,
  script = 'auto',
  setScript,
  contentType = 'adult',
  setContentType,
  sdhMode = false,
  setSdhMode,
  geminiAutoFix = true,
  setGeminiAutoFix,
  glossaryTerms = [],
  setGlossaryTerms = () => {},
  onApply = () => {}
}) {
  const [newGlossaryWord, setNewGlossaryWord] = useState('');
  const fileInputRef = useRef(null);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [fileImportMsg, setFileImportMsg] = useState('');

  const handleAddGlossaryWord = () => {
    const raw = newGlossaryWord.trim();
    if (!raw) return;
    const words = raw.split(/[,;\n]+/).map(w => w.trim()).filter(Boolean);
    const updated = Array.from(new Set([...glossaryTerms, ...words]));
    setGlossaryTerms(updated);
    setNewGlossaryWord('');
  };

  const handleRemoveGlossaryWord = (idx) => {
    const updated = glossaryTerms.filter((_, i) => i !== idx);
    setGlossaryTerms(updated);
  };

  const handleFileImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingFile(true);
    setFileImportMsg('Extracting vocabulary...');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const apiEndpoint = (apiUrl || '').replace(/\/$/, '') + '/api/subtitle/extract_glossary_file';
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        if (data.terms && data.terms.length > 0) {
          const updated = Array.from(new Set([...glossaryTerms, ...data.terms]));
          setGlossaryTerms(updated);
          setFileImportMsg(`✓ Imported ${data.terms.length} terms from ${file.name}`);
          setTimeout(() => setFileImportMsg(''), 4500);
          return;
        } else {
          setFileImportMsg(`No terms found in ${file.name}`);
          setTimeout(() => setFileImportMsg(''), 3000);
        }
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (err) {
      console.warn("Backend file extraction failed, falling back to local text reader:", err);
      try {
        const text = await file.text();
        const parts = text.split(/[\r\n,;\t|]+/).map(w => w.trim().replace(/^["'`]|["'`]$/g, '')).filter(w => w.length >= 2 && w.length <= 80);
        if (parts.length > 0) {
          const updated = Array.from(new Set([...glossaryTerms, ...parts]));
          setGlossaryTerms(updated);
          setFileImportMsg(`✓ Imported ${parts.length} terms from ${file.name}`);
          setTimeout(() => setFileImportMsg(''), 4500);
        } else {
          setFileImportMsg(`Could not extract terms from ${file.name}`);
          setTimeout(() => setFileImportMsg(''), 3000);
        }
      } catch (clientErr) {
        setFileImportMsg(`Failed to read file: ${clientErr.message}`);
        setTimeout(() => setFileImportMsg(''), 3000);
      }
    } finally {
      setIsImportingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const [apiUrl, setApiUrl] = useState(() => {
    try {
      const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
      const saved = cleanUrl(localStorage.getItem('karya_api_url'));
      return saved || envUrl || '';
    } catch {
      return '';
    }
  });
  const [testStatus, setTestStatus] = useState(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsClosing(false);
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  const presets = [
    {
      name: 'Verbatim / Fast Speech',
      desc: 'Dialogue-First · 42 CPL · 25 CPS · 0.5s Min',
      apply: () => {
        setCplLimit(42);
        setCpsLimit(25);
        setMaxLines(2);
        setMinDuration(0.5);
        setMaxDuration(7.0);
        setContentType('adult');
      }
    },
    {
      name: 'Netflix Adult',
      desc: 'Standard 42 CPL · 20 CPS · 2 Lines',
      apply: () => {
        setCplLimit(42);
        setCpsLimit(20);
        setMaxLines(2);
        setMinDuration(0.833);
        setMaxDuration(7.0);
        setContentType('adult');
      }
    },
    {
      name: 'Netflix Kids',
      desc: 'Relaxed 42 CPL · 17 CPS · 2 Lines',
      apply: () => {
        setCplLimit(42);
        setCpsLimit(17);
        setMaxLines(2);
        setMinDuration(0.833);
        setMaxDuration(7.0);
        setContentType('children');
      }
    },
    {
      name: 'Broadcast TV',
      desc: 'Compact 37 CPL · 17 CPS · 25 FPS',
      apply: () => {
        setCplLimit(37);
        setCpsLimit(17);
        setMaxLines(2);
        setMinDuration(1.0);
        setMaxDuration(6.0);
        if (setFrameRate) setFrameRate(25.0);
      }
    },
    {
      name: 'Mobile / Reels',
      desc: 'Short 32 CPL · 22 CPS · 30 FPS',
      apply: () => {
        setCplLimit(32);
        setCpsLimit(22);
        setMaxLines(1);
        setMinDuration(0.6);
        setMaxDuration(4.5);
        if (setFrameRate) setFrameRate(30.0);
      }
    }
  ];

  const handleResetDefaults = () => {
    setCplLimit(42);
    setCpsLimit(20);
    setMaxLines(2);
    setMinDuration(0.833);
    setMaxDuration(7.0);
    setContentType('adult');
    setSdhMode(false);
    setGeminiAutoFix(true);
    if (setFrameRate) setFrameRate(24.0);
    setApiUrl(cleanUrl(import.meta.env.VITE_API_URL) || '');
    setCustomApiBase('');
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in duration-200'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div 
        className={`w-full max-w-2xl rounded-2xl border border-[#262734] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] bg-[#14151a] text-slate-200 ${
          isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
        }`}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#262734] bg-[#14151a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white">Subtitle Studio QC & Generation Settings</h2>
              <p className="text-xs text-slate-400">Configure reading speeds, character caps, and AI correction rules</p>
            </div>
          </div>
          <button 
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-[#22232c] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-6 overflow-y-auto custom-scrollbar text-xs">
          
          {/* Presets Section */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Industry Presets
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {presets.map(p => (
                <button
                  key={p.name}
                  onClick={p.apply}
                  className="p-2.5 rounded-xl border border-[#262734] bg-[#181920] hover:border-[#00e5be] hover:bg-[#22232c] text-left transition-all cursor-pointer"
                >
                  <div className="font-bold text-xs text-[#00e5be]">{p.name}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Core Sliders (CPL & CPS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            {/* Characters Per Line (CPL) */}
            <div className="p-4 rounded-xl border bg-[#181920] border-[#262734]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs">Characters Per Line (CPL)</span>
                <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#00e5be] text-black shadow-xs">
                  {cplLimit} chars
                </span>
              </div>
              <input
                type="range"
                min="28"
                max="50"
                step="1"
                value={cplLimit}
                onChange={e => setCplLimit(parseInt(e.target.value, 10))}
                className="w-full accent-[#00e5be] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>28 (Short)</span>
                <span>42 (Netflix Std)</span>
                <span>50 (Wide)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Maximum characters allowed on a single subtitle line before wrapping.
              </p>
            </div>

            {/* Reading Speed (CPS) */}
            <div className="p-4 rounded-xl border bg-[#181920] border-[#262734]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs">Reading Speed (CPS)</span>
                <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#00e5be] text-black shadow-xs">
                  {cpsLimit} CPS
                </span>
              </div>
              <input
                type="range"
                min="12"
                max="25"
                step="0.5"
                value={cpsLimit}
                onChange={e => setCpsLimit(parseFloat(e.target.value))}
                className="w-full accent-[#00e5be] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                <span>12 (Slow)</span>
                <span>17 (Kids) · 20 (Adult)</span>
                <span>25 (Fast)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Maximum characters per second. Subtitles with CPS above this are flagged for reading fatigue.
              </p>
            </div>
          </div>

          {/* Line Count & Duration Limits */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Max Lines */}
            <div className="p-3 rounded-xl border bg-[#181920] border-[#262734]">
              <span className="font-bold text-xs block mb-2">Max Lines Per Subtitle</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setMaxLines(1)}
                  className={`py-1.5 rounded-lg font-bold text-xs border transition-all cursor-pointer ${
                    maxLines === 1 
                      ? 'bg-[#00e5be] border-[#00e5be] text-black shadow-xs' 
                      : 'bg-[#14151a] text-slate-400 border-[#262734]'
                  }`}
                >
                  1 Line
                </button>
                <button
                  onClick={() => setMaxLines(2)}
                  className={`py-1.5 rounded-lg font-bold text-xs border transition-all cursor-pointer ${
                    maxLines === 2 
                      ? 'bg-[#00e5be] border-[#00e5be] text-black shadow-xs' 
                      : 'bg-[#14151a] text-slate-400 border-[#262734]'
                  }`}
                >
                  2 Lines (Std)
                </button>
              </div>
            </div>

            {/* Min Duration */}
            <div className="p-3 rounded-xl border bg-[#181920] border-[#262734]">
              <div className="flex justify-between mb-1">
                <span className="font-bold text-xs">Min Duration</span>
                <span className="font-mono font-bold text-[#00e5be]">{minDuration.toFixed(3)}s</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={minDuration}
                onChange={e => setMinDuration(parseFloat(e.target.value))}
                className="w-full accent-[#00e5be] cursor-pointer mt-1"
              />
              <span className="text-[10px] text-slate-400 block mt-1">Default 5/6 sec (20 frames)</span>
            </div>

            {/* Max Duration */}
            <div className="p-3 rounded-xl border bg-[#181920] border-[#262734]">
              <div className="flex justify-between mb-1">
                <span className="font-bold text-xs">Max Duration</span>
                <span className="font-mono font-bold text-[#00e5be]">{maxDuration.toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min="3.0"
                max="10.0"
                step="0.5"
                value={maxDuration}
                onChange={e => setMaxDuration(parseFloat(e.target.value))}
                className="w-full accent-[#00e5be] cursor-pointer mt-1"
              />
              <span className="text-[10px] text-slate-400 block mt-1">Netflix standard: 7.0s</span>
            </div>
          </div>

          {/* Video Frame Rate (FPS) Control */}
          <div className="p-4 rounded-xl border bg-[#181920] border-[#262734] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-bold text-xs flex items-center gap-1.5 text-white">
                  🎬 Video Frame Rate (FPS)
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30">
                    Auto-Detected from Media
                  </span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Controls shot-change snap thresholds & 2-frame gap calculations ({((2.0 / (frameRate || 24.0))).toFixed(3)}s gap)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.001"
                  min="1"
                  max="120"
                  value={frameRate}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0 && setFrameRate) {
                      setFrameRate(val);
                    }
                  }}
                  className="w-20 rounded-lg px-2 py-1 text-xs font-mono font-bold border border-[#262734] bg-[#0e0f12] text-[#00e5be] text-right focus:border-[#00e5be] focus:outline-none"
                />
                <span className="font-mono text-xs text-slate-400">FPS</span>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '23.976 (Film)', val: 23.976 },
                { label: '24 (Standard)', val: 24.0 },
                { label: '25 (PAL/Indian TV)', val: 25.0 },
                { label: '29.97 (NTSC)', val: 29.97 },
                { label: '30 (Web/Video)', val: 30.0 },
                { label: '50 (PAL High)', val: 50.0 },
                { label: '59.94 (NTSC High)', val: 59.94 },
                { label: '60 (High FPS)', val: 60.0 },
              ].map(preset => {
                const isSelected = Math.abs((frameRate || 24.0) - preset.val) < 0.01;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setFrameRate && setFrameRate(preset.val)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-[#00e5be] border-[#00e5be] text-black shadow-xs'
                        : 'bg-[#14151a] text-slate-300 border-[#262734] hover:border-slate-500'
                    }`}
                  >
                    {preset.val} FPS
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Self-Correction & Additional Toggles */}
          <div className="space-y-3">
            
            {/* Gemini Multi-Pass Self-Correction Toggle */}
            <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
              geminiAutoFix 
                ? 'bg-[#181920] border-[#00e5be]/40'
                : 'bg-[#181920] border-[#262734]'
            }`}>
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-[#00e5be]/15 text-[#00e5be] mt-0.5">
                  <Sparkles className="w-4 h-4 text-[#00e5be]" />
                </div>
                <div>
                  <div className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                    Gemini AI QC Self-Correction Pass
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#00e5be]/20 text-[#00e5be] border border-[#00e5be]/30 font-semibold uppercase">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Automatically coordinates linter errors back to Gemini to rewrite line breaks and split dense subtitles before finalizing.
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={geminiAutoFix}
                onChange={e => setGeminiAutoFix(e.target.checked)}
                className="rounded accent-[#00e5be] w-5 h-5 cursor-pointer"
              />
            </div>

            {/* Language, Script & SDH Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl border border-[#262734] bg-[#181920] flex flex-col justify-between gap-1.5">
                <div>
                  <span className="font-bold text-xs block">Language Target</span>
                  <span className="text-[10px] text-slate-400">Target spoken language</span>
                </div>
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="rounded-lg px-2 py-1 text-xs border border-[#262734] bg-[#0e0f12] text-white focus:border-[#00e5be] focus:outline-none cursor-pointer"
                >
                  <option value="auto">Auto-Detect</option>
                  <option value="hi">Hindi (हिंदी)</option>
                  <option value="en">English</option>
                  <option value="hinglish">Hinglish (Hindi in Latin)</option>
                  <option value="bn">Bengali (বাংলা)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="te">Telugu (తెలుగు)</option>
                  <option value="mr">Marathi (मराठी)</option>
                  <option value="gu">Gujarati (ગુજરાતી)</option>
                  <option value="pa">Punjabi (ਪੰਜਾਬੀ)</option>
                  <option value="kn">Kannada (ಕನ್ನಡ)</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                  <option value="ur">Urdu (اردو)</option>
                  <option value="es">Spanish (Español)</option>
                  <option value="fr">French (Français)</option>
                  <option value="de">German (Deutsch)</option>
                  <option value="ja">Japanese (日本語)</option>
                  <option value="ko">Korean (한국어)</option>
                  <option value="ar">Arabic (العربية)</option>
                </select>
              </div>

              <div className="p-3 rounded-xl border border-[#262734] bg-[#181920] flex flex-col justify-between gap-1.5">
                <div>
                  <span className="font-bold text-xs block">Script / Alphabet</span>
                  <span className="text-[10px] text-slate-400">Writing system for output</span>
                </div>
                <select
                  value={script}
                  onChange={e => setScript && setScript(e.target.value)}
                  className="rounded-lg px-2 py-1 text-xs border border-[#262734] bg-[#0e0f12] text-[#00e5be] font-semibold focus:border-[#00e5be] focus:outline-none cursor-pointer"
                >
                  <option value="auto">Native / Auto Script</option>
                  <option value="devanagari">Devanagari (देवनागरी)</option>
                  <option value="latin">Latin / Romanized (Hinglish)</option>
                </select>
              </div>

              <div className="p-3 rounded-xl border border-[#262734] bg-[#181920] flex items-center justify-between">
                <div>
                  <span className="font-bold text-xs block">Sound Descriptions (SDH)</span>
                  <span className="text-[10px] text-slate-400">Non-speech sound cues [door slams]</span>
                </div>
                <input
                  type="checkbox"
                  checked={sdhMode}
                  onChange={e => setSdhMode(e.target.checked)}
                  className="rounded accent-[#00e5be] w-4 h-4 cursor-pointer"
                />
              </div>
            </div>

            {/* Project Glossary / Custom Vocabulary Injection */}
            <div className="p-3.5 rounded-xl border border-[#262734] bg-[#181920] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#00e5be]" />
                  <div>
                    <span className="font-bold text-xs block">Project Glossary & Custom Vocabulary</span>
                    <span className="text-[10px] text-slate-400">
                      Forcefully inject character names, gamertags, places & slang into Gemini's proper noun pipeline.
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-[#00e5be] bg-[#00e5be]/10 px-2 py-0.5 rounded border border-[#00e5be]/30">
                  {glossaryTerms.length} terms
                </span>
              </div>

              {/* Tag Input Field & File Import */}
              <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                <input
                  type="text"
                  placeholder="Type term (e.g. Jonathan, Pochinki, GodL, AWM) and press Enter..."
                  value={newGlossaryWord}
                  onChange={(e) => setNewGlossaryWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      handleAddGlossaryWord();
                    }
                  }}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-[#0e0f12] border border-[#262734] text-white placeholder-slate-500 focus:outline-none focus:border-[#00e5be]"
                />
                <button
                  type="button"
                  onClick={handleAddGlossaryWord}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#00e5be] hover:bg-[#00c9a7] text-black transition-colors cursor-pointer shadow-xs shrink-0"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImportingFile}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0e0f12] hover:bg-[#262734] text-slate-200 border border-[#262734] transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
                  title="Import from Word (.docx), Excel (.xlsx/.xls), CSV, or TXT"
                >
                  <FileUp size={13} className="text-[#00e5be]" />
                  <span>{isImportingFile ? 'Importing...' : 'Import File (Word / Excel / CSV)'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.xlsx,.xls,.csv,.txt,.tsv,.json"
                  onChange={handleFileImport}
                  className="hidden"
                />
              </div>

              {/* File Import Feedback Message */}
              {fileImportMsg && (
                <div className="text-[11px] font-mono font-medium text-[#00e5be] bg-[#00e5be]/10 px-2 py-1 rounded border border-[#00e5be]/30 flex items-center gap-1.5 animate-in fade-in">
                  <Check size={12} />
                  <span>{fileImportMsg}</span>
                </div>
              )}

              {/* Chips List */}
              {glossaryTerms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar p-1">
                  {glossaryTerms.map((term, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-[#0e0f12] text-[#00e5be] border border-[#262734] group hover:border-[#00e5be]/50 transition-colors"
                    >
                      <span>{term}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveGlossaryWord(idx)}
                        className="text-slate-500 hover:text-rose-400 cursor-pointer ml-0.5 text-xs font-bold"
                        title="Remove term"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Quick Add Suggestions */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-500">Suggested:</span>
                {['Jonathan', 'Pochinki', 'GodL', 'AWM', 'Camper', 'Flank', 'BGMI', 'Scrims'].map((sug) => {
                  const alreadyAdded = glossaryTerms.includes(sug);
                  if (alreadyAdded) return null;
                  return (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => {
                        const next = [...glossaryTerms, sug];
                        setGlossaryTerms(next);
                      }}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0e0f12] hover:bg-[#262734] text-slate-400 hover:text-[#00e5be] border border-[#262734] transition-colors cursor-pointer"
                    >
                      + {sug}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Backend API URL for Live Website Deployments */}
            <div className="p-3.5 rounded-xl border border-[#262734] bg-[#181920] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#00e5be]" />
                  <div>
                    <span className="font-bold text-xs block">Backend API Server URL</span>
                    <span className="text-[10px] text-slate-400">
                      Required for live websites. Enter base URL without <code className="text-[#00e5be]">/api</code> (e.g. <code className="text-slate-300">https://transcribe-qqwn.onrender.com</code>)
                    </span>
                  </div>
                </div>
                {testStatus && (
                  <span className={`text-[11px] font-semibold ${testStatus.success ? 'text-[#00e5be]' : 'text-rose-400'}`}>
                    {testStatus.message}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={import.meta.env.VITE_API_URL || "https://screening-geographic-math-medal.trycloudflare.com"}
                  value={apiUrl}
                  onChange={e => {
                    setApiUrl(e.target.value);
                    setTestStatus(null);
                  }}
                  className="flex-1 rounded-lg px-3 py-1.5 text-xs font-mono border border-[#262734] bg-[#0e0f12] text-white focus:border-[#00e5be] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const raw = (apiUrl || '').trim().replace(/\/+$/, '').replace(/\/api\/?$/i, '');
                    if (!raw) {
                      setTestStatus({ success: false, message: 'URL is empty (using default proxy)' });
                      return;
                    }
                    try {
                      setTestStatus({ success: true, message: 'Testing...' });
                      let res = await fetch(`${raw}/api/health`, { method: 'GET' }).catch(() => null);
                      if (!res || !res.ok) {
                        res = await fetch(`${raw}/health`, { method: 'GET' }).catch(() => null);
                      }
                      if (!res || !res.ok) {
                        res = await fetch(`${raw}/`, { method: 'GET' }).catch(() => null);
                      }
                      if (res && res.ok) {
                        const data = await res.json().catch(() => ({}));
                        const keyMsg = data.has_gemini_api_key === false ? ' (Note: Gemini API key missing on backend)' : '';
                        setTestStatus({ success: true, message: `Connected ✓ (Backend Online${keyMsg})` });
                      } else {
                        setTestStatus({ success: false, message: res ? `Status ${res.status}` : 'Could not reach server (cold start?)' });
                      }
                    } catch (e) {
                      setTestStatus({ success: false, message: 'Failed: Check URL/HTTPS or CORS' });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border border-[#262734] bg-[#14151a] text-[#00e5be] hover:bg-[#22232c] transition-colors"
                >
                  Test
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#262734] bg-[#14151a] flex items-center justify-between">
          <button
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-[#262734] bg-[#181920] hover:bg-[#22232c] text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
                const oldUrl = cleanUrl(localStorage.getItem('karya_api_url')) || envUrl;
                const newUrl = cleanUrl(apiUrl);
                setCustomApiBase(newUrl);
                onApply();
                onClose();
                if (newUrl !== oldUrl) {
                  window.location.reload();
                }
              }}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00c9a7] active:scale-95 text-black shadow-[0_0_12px_rgba(0,229,190,0.25)] flex items-center gap-1.5 transition-all cursor-pointer border-none"
            >
              <Check className="w-4 h-4" />
              Save & Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
