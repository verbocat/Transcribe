import React, { useState, useEffect, useMemo } from 'react';
import {
  Mic, Film, Sparkles, ArrowRight, ArrowUp, Headphones, Subtitles, Zap, ShieldCheck,
  Play, Pause, Layers, LogOut, User as UserIcon, Building2, CheckCircle2,
  Sliders, Globe, Cpu, Lock, FileText, ChevronDown, ChevronRight, Activity,
  Volume2, ExternalLink, HelpCircle, Search
} from 'lucide-react';
import CursorTrail from './CursorTrail';
import InteractiveEyeHeading from './InteractiveEyeHeading';

export default function LandingPage({ onSelect, user, onLogout, onOpenAuth }) {
  // Interactive Demo Simulator State
  const [isPlayingDemo, setIsPlayingDemo] = useState(false);
  const [demoCps, setDemoCps] = useState(17.4);
  const [demoCpl, setDemoCpl] = useState(36);
  const [activeTab, setActiveTab] = useState('subtitle'); // 'subtitle' | 'waveform' | 'telemetry'
  const [openFaq, setOpenFaq] = useState(0); // Default first FAQ open
  const [faqCategory, setFaqCategory] = useState('All');
  const [faqSearchQuery, setFaqSearchQuery] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Dynamic Mouse-Following Spotlight Coordinates Helper
  const handleMouseMoveCard = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty('--mouse-x', `${x}px`);
    e.currentTarget.style.setProperty('--mouse-y', `${y}px`);
  };

  const handleLaunch = (tool) => {
    if (!user && onOpenAuth) {
      onOpenAuth(tool);
    } else if (onSelect) {
      onSelect(tool);
    }
  };

  const scrollToSection = (sectionId) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isCpsCompliant = demoCps <= 20.0;
  const isCplCompliant = demoCpl <= 42;

  const allFaqs = [
    {
      q: "What makes Karya Studio different from standard speech-to-text tools?",
      a: "Karya Studio combines Google's Gemini Flash Accuracy Model with custom acoustic onset detectors and a broadcast-grade Netflix Timed Text compliance engine. It doesn't just produce text—it formats, linters, and aligns subtitles down to the exact video frame boundaries.",
      category: "Core Engine"
    },
    {
      q: "How does the Netflix Compliance QC Engine work?",
      a: "The QC engine actively inspects your subtitle dataset in real time against official industry criteria: Reading Speed (CPS ≤20 for adults, ≤17 for children), Line Length (CPL ≤42), Line Count (max 2 lines), shot-change snapping (2 frames), and minimum gap chaining (≥2 frames = 0.083s).",
      category: "QC & Netflix"
    },
    {
      q: "Can I edit long-form, multi-hour videos?",
      a: "Yes! The workstation features an adaptive sliced chunked upload pipeline that streams large 4K / 2+ hour video files in non-blocking background batches. You can pause, review, and resume generation from any batch or timeline timestamp.",
      category: "Core Engine"
    },
    {
      q: "Where is my data stored? Is it private?",
      a: "Your data is stored exclusively in a sovereign local SQLite database on your server machine. No transcripts or video files are leaked to third-party databases, and access is strictly gated behind verified @verbolabs.com credentials.",
      category: "Data Sovereignty"
    },
    {
      q: "Which subtitle and transcript export formats are supported?",
      a: "You can instantly export Netflix-standard SRT, WebVTT, broadcast EBU-STL, SMPTE-TT XML, formatted DOCX, tabular CSV, XLSX, and structured JSON with full timestamps and speaker tags.",
      category: "QC & Netflix"
    },
    {
      q: "Does Karya Studio support romanized/phonetic script translation?",
      a: "Yes! Full multi-script support is built-in across 20+ languages including Latin phonetic conversion (e.g. Hindi to Hinglish) with instant preview and bidirectional transliteration.",
      category: "Core Engine"
    }
  ];

  const filteredFaqs = useMemo(() => {
    return allFaqs.filter(faq => {
      const matchesCategory = faqCategory === 'All' || faq.category === faqCategory;
      const matchesSearch = !faqSearchQuery.trim() ||
        faq.q.toLowerCase().includes(faqSearchQuery.toLowerCase()) ||
        faq.a.toLowerCase().includes(faqSearchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [allFaqs, faqCategory, faqSearchQuery]);

  return (
    <div className="min-h-screen bg-[#0e0f12] text-[#f1f2f6] flex flex-col font-sans relative animate-studio-entrance">
      {/* Interactive 3D Cursor Trail */}
      <CursorTrail />

      {/* ── 1. Top Navigation Bar (Fixed with Dynamic Glassmorphism) ── */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 sm:px-8 ${isScrolled
          ? 'py-2.5 bg-[#0e0f12]/95 backdrop-blur-xl border-b border-[#00e5be]/20 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8),0_1px_0_0_rgba(0,229,190,0.15)]'
          : 'py-3.5 bg-[#121318]/85 backdrop-blur-md border-b border-[#262734]'
        }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">

          {/* Logo Brand */}
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#00e5be] via-[#00c4cc] to-[#0077b6] text-black flex items-center justify-center font-black shadow-[0_0_15px_rgba(0,229,190,0.35)] transition-transform duration-200 group-hover:scale-105">
              <Film className="w-4 h-4 fill-black/20 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm sm:text-base tracking-tight text-white font-sans">Karya</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00e5be] to-[#00c9ff] font-extrabold text-sm sm:text-base tracking-tight font-sans">Studio</span>
                <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-[#00e5be]/10 text-[#00e5be] border border-[#00e5be]/30">
                  by VerboLabs
                </span>
              </div>
            </div>
          </div>

          {/* Center Navigation Links (Hidden on mobile) */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
            <button
              type="button"
              onClick={() => scrollToSection('studios')}
              className="hover:text-[#00e5be] transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium text-slate-300"
            >
              Studios
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('simulator')}
              className="hover:text-[#00e5be] transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium text-slate-300"
            >
              Interactive Demo
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('features')}
              className="hover:text-[#00e5be] transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium text-slate-300"
            >
              AI Engine
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('compliance')}
              className="hover:text-[#00e5be] transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium text-slate-300"
            >
              QC Rules
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('faq')}
              className="hover:text-[#00e5be] transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium text-slate-300"
            >
              FAQ
            </button>
          </nav>

          {/* Right Action / Authentication CTA */}
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-xs font-semibold text-slate-200">{user.email?.split('@')[0]}</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Verified Studio Member</span>
                </div>
                <button
                  onClick={() => handleLaunch('subtitle')}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_15px_rgba(0,229,190,0.3)] cursor-pointer flex items-center gap-1.5"
                >
                  <span>Open Studio</span>
                  <ArrowRight size={13} />
                </button>
                {onLogout && (
                  <button
                    onClick={onLogout}
                    className="p-1.5 rounded-lg hover:bg-[#181920] text-slate-400 hover:text-rose-400 border border-transparent hover:border-[#262734] transition-all cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onOpenAuth ? onOpenAuth('login') : null}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-[#181920] transition-colors cursor-pointer"
                >
                  Sign In
                </button>
                <button
                  onClick={() => onOpenAuth ? onOpenAuth('signup') : null}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_15px_rgba(0,229,190,0.3)] cursor-pointer flex items-center gap-1.5"
                >
                  <span>Get Started</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            )}
          </div>

        </div>
      </header>

      {/* ── 2. Hero Section ── */}
      <section className="relative pt-28 sm:pt-36 pb-20 px-4 sm:px-8 flex flex-col items-center justify-center text-center overflow-hidden">
        {/* Ambient Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[350px] bg-gradient-to-tr from-[#00e5be]/15 to-[#00b4d8]/10 blur-[130px] pointer-events-none rounded-full" />
        <div className="absolute top-3/4 left-1/4 w-[400px] h-[250px] bg-gradient-to-br from-[#00c9ff]/10 to-transparent blur-[100px] pointer-events-none rounded-full" />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#181920] border border-[#262734] mb-6 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-[#00e5be]" />
            <span className="text-xs font-semibold text-slate-300 tracking-wide">
              Powered by Gemini Flash Accuracy Model & Acoustic Waveform Engine
            </span>
          </div>

          {/* Heading */}
          <div className="mb-5 flex justify-center">
            <InteractiveEyeHeading
              text="Enterprise Speech Transcription & "
              highlightText="Broadcast-Grade Subtitles"
              as="h1"
              className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.15] text-center"
              highlightClassName="text-transparent bg-clip-text bg-gradient-to-r from-[#00e5be] via-[#00c9ff] to-[#38bdf8] drop-shadow-[0_0_25px_rgba(0,229,190,0.35)]"
            />
          </div>

          {/* Subtitle */}
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto font-normal leading-relaxed mb-8">
            Engineered for high-volume localization studios, broadcasters, and enterprises. Instant acoustic diarization, Netflix-certified timed-text QC, and precision waveform editing in a single sovereign workstation.
          </p>

          {/* Dual Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 mb-12">
            <button
              onClick={() => handleLaunch('subtitle')}
              className="relative overflow-hidden group px-6 py-3 rounded-xl text-sm font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_25px_rgba(0,229,190,0.35)] hover:shadow-[0_0_45px_rgba(0,229,190,0.6),0_0_70px_rgba(0,201,255,0.3)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center gap-2"
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />
              <Film size={16} className="transition-transform duration-200 group-hover:rotate-6" />
              <span>Launch Subtitle Studio</span>
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1" />
            </button>

            <button
              onClick={() => handleLaunch('transcribe')}
              className="relative overflow-hidden group px-5 py-3 rounded-xl text-sm font-semibold border border-[#262734] bg-[#14151a] hover:bg-[#181920] hover:border-[#00e5be]/50 text-slate-200 hover:text-white transition-all shadow-md hover:shadow-[0_0_25px_rgba(0,229,190,0.2)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer flex items-center gap-2"
            >
              <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out bg-gradient-to-r from-transparent via-[#00e5be]/10 to-transparent pointer-events-none" />
              <Mic size={16} className="text-[#00e5be] transition-transform duration-200 group-hover:scale-110" />
              <span>Explore Transcribe Studio</span>
              <ArrowRight size={14} className="text-slate-500 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-[#00e5be]" />
            </button>
          </div>

          {/* Key Metric Highlights Strip with Dynamic Spotlight */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto text-left">
            <div
              onMouseMove={handleMouseMoveCard}
              className="p-3.5 rounded-xl bg-[#14151a]/90 border border-[#262734] hover:border-[#00e5be]/40 backdrop-blur-md spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="text-xl sm:text-2xl font-black text-white font-mono">20+</div>
              <div className="text-[11px] text-slate-400 font-medium">Indic & Global Languages</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className="p-3.5 rounded-xl bg-[#14151a]/90 border border-[#262734] hover:border-[#00e5be]/50 backdrop-blur-md spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="text-xl sm:text-2xl font-black text-[#00e5be] font-mono">≥98%</div>
              <div className="text-[11px] text-slate-400 font-medium">Target QC Compliance</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className="p-3.5 rounded-xl bg-[#14151a]/90 border border-[#262734] hover:border-[#00c9ff]/50 backdrop-blur-md spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="text-xl sm:text-2xl font-black text-[#00c9ff] font-mono">42 / 20</div>
              <div className="text-[11px] text-slate-400 font-medium">Max CPL & CPS Rules</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className="p-3.5 rounded-xl bg-[#14151a]/90 border border-[#262734] hover:border-emerald-500/50 backdrop-blur-md spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono">100%</div>
              <div className="text-[11px] text-slate-400 font-medium">Local SQLite Sovereignty</div>
            </div>
          </div>

        </div>
      </section>

      {/* ── 3. Interactive Live Studio Simulator & Compliance QC ── */}
      <section id="simulator" className="scroll-mt-20 py-12 px-4 sm:px-8 max-w-5xl mx-auto w-full relative">
        <div id="compliance" className="absolute -top-20" />
        <div className="text-center mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">Experience the Live QC Workstation Engine</h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Interact with our subtitle rule engine below. Adjust CPL & CPS to see how real-time Netflix linting validates speech timing.
          </p>
        </div>

        {/* Mock Workstation Canvas with Dynamic Spotlight */}
        <div
          onMouseMove={handleMouseMoveCard}
          className="bg-[#14151a] border border-[#262734] hover:border-[#00e5be]/40 rounded-2xl shadow-2xl overflow-hidden spotlight-card transition-all"
        >
          {/* Workstation Top Bar Mock */}
          <div className="bg-[#121318] border-b border-[#262734] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="text-xs font-mono text-slate-400 ml-2">demo_narration_24fps.mp4</span>
            </div>

            {/* Interactive Tabs */}
            <div className="flex items-center gap-1 bg-[#0e0f12] p-0.5 rounded-lg border border-[#262734] text-xs">
              <button
                onClick={() => setActiveTab('subtitle')}
                className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer ${activeTab === 'subtitle' ? 'bg-[#22232c] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Subtitle View
              </button>
              <button
                onClick={() => setActiveTab('waveform')}
                className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer ${activeTab === 'waveform' ? 'bg-[#22232c] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                Waveform Timeline
              </button>
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer ${activeTab === 'telemetry' ? 'bg-[#22232c] text-white' : 'text-slate-400 hover:text-white'}`}
              >
                QC Telemetry
              </button>
            </div>
          </div>

          {/* Interactive Screen Area */}
          <div className="p-6">
            {activeTab === 'subtitle' && (
              <div className="space-y-4 animate-tab-slide">
                {/* Simulated Subtitle Grid Event */}
                <div className="bg-[#0e0f12] border border-[#262734] rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono font-bold text-[#00e5be]">#01</span>
                      <span className="text-[11px] font-mono text-slate-400">00:01.200 → 00:03.450 (2.250s)</span>
                      <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-bold ${isCpsCompliant ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
                        {demoCps} CPS
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-bold ${isCplCompliant ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
                        {demoCpl} CPL
                      </span>
                    </div>
                    <p className="text-sm font-medium text-slate-100 font-sans leading-relaxed">
                      "In today's global landscape, high-precision speech localization empowers audiences everywhere."
                    </p>
                  </div>

                  {/* Compliance Status Chip */}
                  <div className="shrink-0 flex items-center gap-2">
                    {isCpsCompliant && isCplCompliant ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                        <CheckCircle2 size={14} />
                        <span>Netflix Compliant</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold">
                        <span>Linter Warning: {demoCps > 20 ? 'CPS > 20' : 'CPL > 42'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Interactive Sliders for Live Demonstration */}
                <div className="bg-[#181920] border border-[#262734] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                      <span>Reading Speed (CPS)</span>
                      <span className="font-mono text-[#00e5be]">{demoCps} CPS (Limit ≤ 20.0)</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="28"
                      step="0.2"
                      value={demoCps}
                      onChange={(e) => setDemoCps(parseFloat(e.target.value))}
                      className="w-full accent-[#00e5be] cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                      <span>Characters Per Line (CPL)</span>
                      <span className="font-mono text-[#00c9ff]">{demoCpl} CPL (Limit ≤ 42)</span>
                    </div>
                    <input
                      type="range"
                      min="25"
                      max="55"
                      step="1"
                      value={demoCpl}
                      onChange={(e) => setDemoCpl(parseInt(e.target.value, 10))}
                      className="w-full accent-[#00c9ff] cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'waveform' && (
              <div className="space-y-4 animate-tab-slide">
                {/* Simulated Audio Waveform with Moving Playhead */}
                <div className="bg-[#0e0f12] border border-[#262734] rounded-xl p-5 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-3 text-xs text-slate-400 font-mono">
                    <span className="flex items-center gap-1.5 text-[#00e5be]">
                      <Volume2 size={14} />
                      <span>Audio Channel 01 (Mono 48kHz)</span>
                    </span>
                    <span>Shot Boundary: 00:04.120</span>
                  </div>

                  {/* Fake Audio Waveform bars */}
                  <div className="h-16 flex items-center justify-between gap-1 relative">
                    {[40, 65, 85, 30, 95, 55, 75, 45, 90, 80, 25, 70, 95, 60, 40, 85, 90, 50, 75, 65, 35, 90, 80, 60, 70, 85, 40, 95, 50, 65, 80].map((h, i) => (
                      <div
                        key={i}
                        style={{ height: `${h}%` }}
                        className={`w-full rounded-sm transition-all duration-300 ${i >= 6 && i <= 22 ? 'bg-[#00e5be]' : 'bg-[#282a3a]'}`}
                      />
                    ))}
                    {/* Simulated Subtitle Region Overlay */}
                    <div className="absolute top-0 bottom-0 left-[20%] right-[30%] bg-[#00e5be]/15 border-x-2 border-[#00e5be] pointer-events-none rounded flex items-center justify-center">
                      <span className="text-[10px] font-mono font-bold text-white bg-black/60 px-2 py-0.5 rounded">
                        Active Subtitle Event [01:200 - 03:450]
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 text-center">
                  Drag handles allow frame-level acoustic boundary snapping directly against speech pulses.
                </p>
              </div>
            )}

            {activeTab === 'telemetry' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-tab-slide">
                <div className="p-4 rounded-xl bg-[#0e0f12] border border-[#262734]">
                  <div className="text-xs font-semibold text-slate-400 mb-1">Temporal Alignment</div>
                  <div className="text-lg font-bold text-[#00e5be] font-mono">Frame-Accurate</div>
                  <div className="text-[11px] text-slate-500 mt-1">Snaps to 24, 25, 29.97, & 30 FPS</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0e0f12] border border-[#262734]">
                  <div className="text-xs font-semibold text-slate-400 mb-1">Overlap Elimination</div>
                  <div className="text-lg font-bold text-emerald-400 font-mono">0.000s Overlap</div>
                  <div className="text-[11px] text-slate-500 mt-1">Automatic 2-frame min gap chaining</div>
                </div>
                <div className="p-4 rounded-xl bg-[#0e0f12] border border-[#262734]">
                  <div className="text-xs font-semibold text-slate-400 mb-1">Diarization Engine</div>
                  <div className="text-lg font-bold text-[#00c9ff] font-mono">Multi-Speaker</div>
                  <div className="text-[11px] text-slate-500 mt-1">Acoustic speaker turns & confidence</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 4. The Dual Studios Showcase ── */}
      <section id="studios" className="scroll-mt-20 py-16 px-4 sm:px-8 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181920] border border-[#262734] mb-3">
            <Layers className="w-3.5 h-3.5 text-[#00e5be]" />
            <span className="text-xs font-semibold text-slate-300">Choose Your Workstation</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">
            Two Specialized Production Suites
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Switch effortlessly between full conversational verbatim audio transcription and precision timed-text subtitle editing.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Card 1: Transcribe Studio with Dynamic 3D Spotlight */}
          <div
            onMouseMove={handleMouseMoveCard}
            className="group bg-[#14151a] hover:bg-[#181920] border border-[#262734] hover:border-[#00e5be] rounded-2xl p-8 transition-all duration-300 shadow-xl hover:shadow-[0_20px_50px_rgba(0,229,190,0.16)] flex flex-col justify-between spotlight-card tilt-card relative"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-14 h-14 rounded-2xl bg-[#1a1b24] border border-[#262738] group-hover:border-[#00e5be]/50 flex items-center justify-center text-[#00e5be] shadow-inner group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(0,229,190,0.3)] transition-all duration-300">
                  <Mic size={28} />
                </div>
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-[#1a1b24] text-slate-400 border border-[#282a38] group-hover:border-[#00e5be]/30 group-hover:text-[#00e5be] transition-colors uppercase">
                  Acoustic Verbatim
                </span>
              </div>

              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-[#00e5be] transition-colors">Transcribe Studio</h3>
              <p className="text-xs sm:text-sm text-slate-400 mb-6 leading-relaxed">
                Designed for transcriptionists and speech linguists. Deep acoustic diarization isolates individual speakers, flags hesitations, and validates accuracy.
              </p>

              <div className="space-y-3 mb-8 text-xs text-slate-300">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00e5be] shrink-0 mt-0.5" />
                  <span><strong>Multi-Speaker Diarization</strong>: Automatic speaker classification with customizable names and colors.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00e5be] shrink-0 mt-0.5" />
                  <span><strong>Verbatim Guidelines Linter</strong>: Live verification against strict verbatim transcription standards.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00e5be] shrink-0 mt-0.5" />
                  <span><strong>Wide Format Ingestion</strong>: Lossless WAV, FLAC, MP3, M4A, OGG, and WebM.</span>
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-[#22232c] flex items-center justify-between">
              <button
                onClick={() => handleLaunch('transcribe')}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#1e202a] hover:bg-[#00e5be] text-white hover:text-black transition-all shadow-[0_0_15px_rgba(0,0,0,0.3)] hover:shadow-[0_0_25px_rgba(0,229,190,0.4)] cursor-pointer flex items-center gap-2"
              >
                <span>Launch Transcribe Studio</span>
                <ArrowRight size={14} />
              </button>
              <span className="text-[11px] font-mono text-slate-500">CSV · DOCX · SRT</span>
            </div>
          </div>

          {/* Card 2: Subtitle Studio with Dynamic 3D Spotlight */}
          <div
            onMouseMove={handleMouseMoveCard}
            className="group bg-[#14151a] hover:bg-[#181920] border border-[#262734] hover:border-[#00c9ff] rounded-2xl p-8 transition-all duration-300 shadow-xl hover:shadow-[0_20px_50px_rgba(0,201,255,0.16)] flex flex-col justify-between spotlight-card tilt-card relative"
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-14 h-14 rounded-2xl bg-[#1a1b24] border border-[#262738] group-hover:border-[#00c9ff]/50 flex items-center justify-center text-[#00c9ff] shadow-inner group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(0,201,255,0.3)] transition-all duration-300">
                  <Film size={28} />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-[#00c9ff]/10 text-[#00c9ff] border border-[#00c9ff]/30 uppercase">
                  <Sparkles size={12} />
                  PRO NLE
                </span>
              </div>

              <h3 className="text-2xl font-bold text-white mb-2 group-hover:text-[#00c9ff] transition-colors">Subtitle Studio</h3>
              <p className="text-xs sm:text-sm text-slate-400 mb-6 leading-relaxed">
                Professional broadcast subtitle workstation. Features synchronized video canvas, CapCut-style drag timeline, and automated Netflix compliance correction.
              </p>

              <div className="space-y-3 mb-8 text-xs text-slate-300">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00c9ff] shrink-0 mt-0.5" />
                  <span><strong>Netflix Timed Text QC Engine</strong>: Auto-fixes CPS ≤20, CPL ≤42, and shot boundaries.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00c9ff] shrink-0 mt-0.5" />
                  <span><strong>Acoustic Waveform Snapping</strong>: Snaps subtitle in/out cues to actual speech audio onset energy.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className="text-[#00c9ff] shrink-0 mt-0.5" />
                  <span><strong>Universal Deliverables</strong>: Export directly to Netflix TTML (DFXP/IMSC1.1), SRT, and VTT.</span>
                </div>
              </div>
            </div>

            <div className="pt-5 border-t border-[#22232c] flex items-center justify-between">
              <button
                onClick={() => handleLaunch('subtitle')}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] hover:shadow-[0_0_30px_rgba(0,229,190,0.5)] cursor-pointer flex items-center gap-2"
              >
                <span>Launch Subtitle Studio</span>
                <ArrowRight size={14} />
              </button>
              <span className="text-[11px] font-mono text-slate-500">TTML · SRT · VTT</span>
            </div>
          </div>

        </div>
      </section>

      {/* ── 5. Enterprise Engine Architecture ── */}
      <section id="features" className="scroll-mt-20 py-16 px-4 sm:px-8 bg-[#121318]/60 border-y border-[#262734]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">Engineered for Studio Quality</h2>
            <p className="text-xs sm:text-sm text-slate-400">Under the hood of Karya Studio's real-time speech processing pipeline.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div
              onMouseMove={handleMouseMoveCard}
              className="p-5 rounded-xl bg-[#14151a] border border-[#262734] hover:border-[#00e5be]/40 spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#00e5be]/10 border border-[#00e5be]/30 flex items-center justify-center text-[#00e5be] mb-4 shadow-[0_0_12px_rgba(0,229,190,0.2)]">
                <Cpu size={20} />
              </div>
              <h4 className="text-base font-bold text-white mb-1.5">Gemini Flash Accuracy Model</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Multimodal speech-to-text pipeline captures nuances, colloquial phrases, and code-mixed dialogues like Hinglish with high fidelity.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className="p-5 rounded-xl bg-[#14151a] border border-[#262734] hover:border-[#00c9ff]/40 spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-[#00c9ff]/10 border border-[#00c9ff]/30 flex items-center justify-center text-[#00c9ff] mb-4 shadow-[0_0_12px_rgba(0,201,255,0.2)]">
                <Activity size={20} />
              </div>
              <h4 className="text-base font-bold text-white mb-1.5">Acoustic Audio Sync</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Whisper + VAD acoustic speech onset detector re-anchors generated subtitles to audio waveforms, eliminating drift.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className="p-5 rounded-xl bg-[#14151a] border border-[#262734] hover:border-emerald-500/40 spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <ShieldCheck size={20} />
              </div>
              <h4 className="text-base font-bold text-white mb-1.5">Netflix QC Linter</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Deterministic compliance auditing checks reading speeds (CPS), line lengths (CPL), and minimum shot gaps with auto-repair.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className="p-5 rounded-xl bg-[#14151a] border border-[#262734] hover:border-amber-500/40 spotlight-card tilt-card shadow-lg transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-[0_0_12px_rgba(245,158,11,0.2)]">
                <Lock size={20} />
              </div>
              <h4 className="text-base font-bold text-white mb-1.5">Sovereign SQLite</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                All accounts, session tokens, and drafts reside locally in your server's secure SQLite database without external cloud exposure.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. Supported Languages Matrix ── */}
      <section className="py-14 px-4 sm:px-8 max-w-5xl mx-auto w-full text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181920] border border-[#262734] mb-3">
          <Globe size={14} className="text-[#00e5be]" />
          <span className="text-xs font-semibold text-slate-300">Global & Indic Localization</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">Support for 20+ Languages & Dialects</h2>
        <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto mb-8">
          Process audio and generate subtitles in native scripts or phonetic Latin (Romanized) with seamless script conversion.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl mx-auto">
          {[
            "English", "Hindi (हिंदी)", "Hinglish (Latin)", "Bengali (বাংলা)", "Tamil (தமிழ்)",
            "Telugu (తెలుగు)", "Marathi (मराठी)", "Gujarati (ગુજરાતી)", "Punjabi (ਪੰਜਾਬੀ)",
            "Kannada (ಕನ್ನಡ)", "Malayalam (മലയാളം)", "Urdu (اردو)", "Spanish (Español)",
            "French (Français)", "German (Deutsch)", "Japanese (日本語)", "Korean (한국어)", "Arabic (العربية)"
          ].map((lang) => (
            <span
              key={lang}
              className="px-3.5 py-1.5 rounded-xl bg-[#14151a] border border-[#262734] text-xs text-slate-300 hover:border-[#00e5be] hover:text-[#00e5be] hover:scale-105 hover:bg-[#1a1b24] hover:shadow-[0_0_15px_rgba(0,229,190,0.2)] transition-all duration-200 cursor-default shadow-xs"
            >
              {lang}
            </span>
          ))}
        </div>
      </section>

      {/* ── 7. Frequently Asked Questions (Interactive Search & Categories) ── */}
      <section id="faq" className="scroll-mt-20 py-16 px-4 sm:px-8 bg-[#121318]/40 border-t border-[#262734]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181920] border border-[#262734] mb-3">
              <HelpCircle size={14} className="text-[#00e5be]" />
              <span className="text-xs font-semibold text-slate-300">Knowledge Base & FAQ</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">Frequently Asked Questions</h2>
            <p className="text-xs sm:text-sm text-slate-400">Everything you need to know about Karya Studio and its capabilities.</p>
          </div>

          {/* Interactive Search Bar & Category Filter Pills */}
          <div className="space-y-4 mb-6">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={faqSearchQuery}
                onChange={(e) => setFaqSearchQuery(e.target.value)}
                placeholder="Search FAQ questions (e.g. Netflix, audio, SQLite, rules)..."
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#14151a] border border-[#262734] focus:border-[#00e5be]/60 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#00e5be]/40 transition-all shadow-inner"
              />
              {faqSearchQuery && (
                <button
                  type="button"
                  onClick={() => setFaqSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Category Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {['All', 'Core Engine', 'QC & Netflix', 'Data Sovereignty'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFaqCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${faqCategory === cat
                        ? 'bg-[#00e5be] text-black shadow-[0_0_15px_rgba(0,229,190,0.35)]'
                        : 'bg-[#181920] text-slate-400 hover:text-white border border-[#262734] hover:border-[#3a3b4e]'
                      }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {filteredFaqs.length} question{filteredFaqs.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* FAQ Accordion List with Dynamic Spotlight & Micro-Animations */}
          <div className="space-y-3">
            {filteredFaqs.length > 0 ? (
              filteredFaqs.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div
                    key={index}
                    onMouseMove={handleMouseMoveCard}
                    className={`rounded-xl border overflow-hidden transition-all spotlight-card ${isOpen
                        ? 'bg-[#181922] border-[#00e5be]/50 shadow-[0_0_25px_rgba(0,229,190,0.12)]'
                        : 'bg-[#14151a] border-[#262734] hover:border-slate-700'
                      }`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-slate-200 hover:text-white cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-[#20222d] text-[#00e5be] border border-[#2c2e3d]">
                          #{String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="group-hover:text-[#00e5be] transition-colors">{faq.q}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] hidden sm:inline-block font-mono uppercase px-2 py-0.5 rounded bg-[#0e0f12] text-slate-400 border border-[#262734]">
                          {faq.category}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#00e5be]' : 'group-hover:text-slate-200'
                            }`}
                        />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-4 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-[#22232c] pt-3 animate-tab-slide bg-[#121319]/80">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="text-center py-10 bg-[#14151a] border border-[#262734] rounded-xl text-slate-400 text-xs">
                No matching questions found for "{faqSearchQuery}".
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 8. Call to Action Banner ── */}
      <section className="py-16 px-4 sm:px-8 max-w-4xl mx-auto w-full text-center">
        <div className="p-8 sm:p-12 rounded-2xl bg-gradient-to-tr from-[#14151a] via-[#181922] to-[#121318] border border-[#262734] relative overflow-hidden shadow-2xl">
          <div className="absolute -top-20 -right-20 w-48 h-48 bg-[#00e5be]/10 rounded-full blur-3xl pointer-events-none" />
          <div className="mb-3 flex justify-center">
            <InteractiveEyeHeading
              text="Accelerate Your Localization Workflows Today"
              as="h2"
              className="text-2xl sm:text-3xl font-extrabold text-white text-center"
            />
          </div>
          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto mb-6 leading-relaxed">
            Join the VerboLabs team in producing broadcast-standard subtitles and verbatim transcripts faster than ever.
          </p>
          <button
            onClick={() => handleLaunch('subtitle')}
            className="relative overflow-hidden group px-7 py-3.5 rounded-xl text-sm font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_25px_rgba(0,229,190,0.4)] hover:shadow-[0_0_45px_rgba(0,229,190,0.65),0_0_80px_rgba(0,201,255,0.35)] hover:-translate-y-0.5 active:translate-y-0 cursor-pointer inline-flex items-center gap-2"
          >
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />
            <span>Launch Workstation</span>
            <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1.5" />
          </button>
        </div>
      </section>

      {/* ── 9. Footer ── */}
      <footer className="border-t border-[#262734] bg-[#0e0f12] px-4 sm:px-8 py-8 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">Karya Studio</span>
            <span>·</span>
            <span>VerboLabs Languages Pvt. Ltd.</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400 text-[11px] font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>All Systems Operational</span>
            <span>·</span>
            <span>Netflix Timed Text Certified</span>
          </div>
        </div>
      </footer>

      {/* ── Floating Back to Top Button ── */}
      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-[#14151a]/95 hover:bg-[#1c1e26] border border-[#262734] hover:border-[#00e5be]/70 text-[#00e5be] hover:text-white shadow-[0_8px_25px_rgba(0,0,0,0.7),0_0_15px_rgba(0,229,190,0.25)] hover:shadow-[0_8px_35px_rgba(0,0,0,0.9),0_0_30px_rgba(0,229,190,0.5)] backdrop-blur-xl transition-all duration-300 transform hover:-translate-y-1 active:translate-y-0 cursor-pointer animate-mac-squish flex items-center justify-center group overflow-hidden"
          title="Back to Top"
          aria-label="Back to Top"
        >
          {/* Subtle pulsating glow ring */}
          <span className="absolute inset-0 rounded-full bg-[#00e5be]/20 animate-ping opacity-75 pointer-events-none" />
          <ArrowUp size={18} className="relative z-10 transition-transform duration-200 group-hover:-translate-y-0.5" />
        </button>
      )}

    </div>
  );
}
