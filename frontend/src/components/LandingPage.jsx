import React, { useState, useEffect, useMemo } from 'react';
import {
  Mic, Film, Sparkles, ArrowRight, ArrowUp, Headphones, Subtitles, Zap, ShieldCheck,
  Play, Pause, Layers, LogOut, User as UserIcon, Building2, CheckCircle2,
  Sliders, Globe, Cpu, Lock, FileText, ChevronDown, ChevronRight, Activity,
  Volume2, ExternalLink, HelpCircle, Search
} from 'lucide-react';
import InteractiveEyeHeading from './InteractiveEyeHeading';
import AccountMenuDropdown from './AccountMenuDropdown';
import NotificationBellDropdown from './NotificationBellDropdown';
import ThemeToggle from './ThemeToggle';
import { useTheme } from '../context/ThemeContext';

export default function LandingPage({ onSelect, user, onLogout, onOpenAuth }) {
  const { isDark } = useTheme();
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
    <div className={`min-h-screen flex flex-col font-sans relative animate-studio-entrance ${
      isDark ? 'bg-[var(--kt-s0)] text-[var(--kt-text)]' : 'bg-[#f8fafc] text-[var(--kt-s2)]'
    }`}>
      {/* ── 1. Top Navigation Bar (Fixed with Dynamic Glassmorphism) ── */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 sm:px-8 ${
        isScrolled
          ? (isDark
              ? 'py-2.5 bg-[var(--kt-s0)]/95 backdrop-blur-xl border-b border-[var(--kt-accent)]/20 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.8)]'
              : 'py-2.5 bg-white/95 backdrop-blur-xl border-b border-slate-200 shadow-xs')
          : (isDark
              ? 'py-3.5 bg-[var(--kt-s1)]/85 backdrop-blur-md border-b border-[var(--kt-s4)]'
              : 'py-3.5 bg-white/90 backdrop-blur-md border-b border-slate-200 shadow-2xs')
      }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">

          {/* Logo Brand */}
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black transition-transform duration-200 group-hover:scale-105 shadow-xs ${
              isDark
                ? 'bg-gradient-to-tr from-[var(--kt-accent)] via-[var(--kt-accent-2)] to-[#0077b6] text-black shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.35)]'
                : 'bg-gradient-to-tr from-blue-600 via-blue-700 to-indigo-700 text-white'
            }`}>
              <Film className={`w-4 h-4 ${isDark ? 'fill-black/20 text-black' : 'fill-white/20 text-white'}`} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className={`font-extrabold text-sm sm:text-base tracking-tight font-sans ${isDark ? 'text-white' : 'text-slate-900'}`}>Karya</span>
                <span className={`font-extrabold text-sm sm:text-base tracking-tight font-sans ${
                  isDark
                    ? 'text-transparent bg-clip-text bg-gradient-to-r from-[var(--kt-accent)] to-[var(--kt-info)]'
                    : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-indigo-700'
                }`}>Studio</span>
                <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded border ${
                  isDark
                    ? 'bg-[var(--kt-accent)]/10 text-[var(--kt-accent)] border-[var(--kt-accent)]/30'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  by VerboLabs
                </span>
              </div>
            </div>
          </div>

          {/* Center Navigation Links (Hidden on mobile) */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium">
            {[
              { id: 'studios', label: 'Studios' },
              { id: 'simulator', label: 'Interactive Demo' },
              { id: 'features', label: 'AI Engine' },
              { id: 'compliance', label: 'QC Rules' },
              { id: 'faq', label: 'FAQ' },
            ].map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollToSection(link.id)}
                className={`transition-colors cursor-pointer bg-transparent border-0 p-0 text-xs font-medium ${
                  isDark
                    ? 'text-slate-300 hover:text-[var(--kt-accent)]'
                    : 'text-slate-600 hover:text-blue-600'
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>

          {/* Right Action / Authentication CTA */}
          <div className="flex items-center gap-2.5">
            {user ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLaunch('subtitle')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isDark
                      ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.3)]'
                      : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-xs'
                  }`}
                >
                  <span className={isDark ? "text-black" : "text-white"}>Open Studio</span>
                  <ArrowRight size={13} className={isDark ? "text-black" : "text-white"} />
                </button>

                {/* In-App Administrative Notices & Alerts */}
                <NotificationBellDropdown />

                {/* Acoustic Theme Toggle Button */}
                <ThemeToggle />

                {/* Account & Status Menu */}
                <AccountMenuDropdown
                  user={user}
                  onOpenLogoutModal={onLogout}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {/* Acoustic Theme Toggle Button */}
                <ThemeToggle />

                <button
                  onClick={() => onOpenAuth ? onOpenAuth('login') : null}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isDark
                      ? 'text-slate-300 hover:text-white hover:bg-[var(--kt-s2)]'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Sign In
                </button>
                <button
                  onClick={() => onOpenAuth ? onOpenAuth('signup') : null}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isDark
                      ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.3)]'
                      : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-xs'
                  }`}
                >
                  <span className={isDark ? "text-black" : "text-white"}>Get Started</span>
                  <ArrowRight size={13} className={isDark ? "text-black" : "text-white"} />
                </button>
              </div>
            )}
          </div>

        </div>
      </header>

      {/* ── 2. Hero Section ── */}
      <section className="relative pt-28 sm:pt-36 pb-20 px-4 sm:px-8 flex flex-col items-center justify-center text-center overflow-hidden">
        {/* Ambient Glows */}
        <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[650px] h-[350px] blur-[130px] pointer-events-none rounded-full ${
          isDark ? 'bg-gradient-to-tr from-[var(--kt-accent)]/15 to-[var(--kt-accent-2)]/10' : 'bg-gradient-to-tr from-blue-500/8 to-indigo-400/6'
        }`} />
        <div className={`absolute top-3/4 left-1/4 w-[400px] h-[250px] blur-[100px] pointer-events-none rounded-full ${
          isDark ? 'bg-gradient-to-br from-[var(--kt-info)]/10 to-transparent' : 'bg-gradient-to-br from-blue-400/8 to-transparent'
        }`} />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <div className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full mb-6 border shadow-xs ${
            isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-white border-slate-200 text-slate-700'
          }`}>
            <Sparkles className={`w-3.5 h-3.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`} />
            <span className="text-xs font-semibold tracking-wide">
              Powered by Gemini Flash Accuracy Model & Acoustic Waveform Engine
            </span>
          </div>

          {/* Heading */}
          <div className="mb-5 flex justify-center">
            <InteractiveEyeHeading
              text="Enterprise Speech Transcription & "
              highlightText="Broadcast-Grade Subtitles"
              as="h1"
              className={`text-4xl sm:text-6xl font-extrabold tracking-tight leading-[1.15] text-center ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
              highlightClassName={
                isDark
                  ? 'text-transparent bg-clip-text bg-gradient-to-r from-[var(--kt-accent)] via-[var(--kt-info)] to-[#7fb2ff] drop-shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.35)]'
                  : 'text-transparent bg-clip-text bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900'
              }
            />
          </div>

          {/* Subtitle */}
          <p className={`text-sm sm:text-base max-w-2xl mx-auto font-normal leading-relaxed mb-8 ${
            isDark ? 'text-slate-400' : 'text-slate-600'
          }`}>
            Engineered for high-volume localization studios, broadcasters, and enterprises. Instant acoustic diarization, Netflix-certified timed-text QC, and precision waveform editing in a single sovereign workstation.
          </p>

          {/* Dual Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 mb-12">
            <button
              onClick={() => handleLaunch('subtitle')}
              className={`relative overflow-hidden group px-6 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer flex items-center gap-2 ${
                isDark
                  ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.35)] hover:shadow-[0_0_45px_rgba(var(--kt-accent-rgb),0.6)]'
                  : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md hover:shadow-blue-500/20'
              } hover:-translate-y-0.5 active:translate-y-0`}
            >
              <Film size={16} className="transition-transform duration-200 group-hover:rotate-6 text-current" />
              <span className="text-white">Launch Subtitle Studio</span>
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-1 text-white" />
            </button>

            <button
              onClick={() => handleLaunch('transcribe')}
              className={`relative overflow-hidden group px-5 py-3 rounded-xl text-sm font-semibold border transition-all cursor-pointer flex items-center gap-2 ${
                isDark
                  ? 'border-[var(--kt-s4)] bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] hover:border-[var(--kt-accent)]/50 text-slate-200 hover:text-white shadow-md'
                  : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800 shadow-xs'
              } hover:-translate-y-0.5 active:translate-y-0`}
            >
              <Mic size={16} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
              <span>Explore Transcribe Studio</span>
              <ArrowRight size={14} className={isDark ? 'text-slate-500 group-hover:text-[var(--kt-accent)]' : 'text-slate-400 group-hover:text-blue-600'} />
            </button>
          </div>

          {/* Key Metric Highlights Strip with Dynamic Spotlight */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto text-left">
            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-3.5 rounded-xl border backdrop-blur-md spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)]/90 border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/40 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-blue-500/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`text-xl sm:text-2xl font-black font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>20+</div>
              <div className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Indic & Global Languages</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-3.5 rounded-xl border backdrop-blur-md spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)]/90 border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/50 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-blue-500/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`text-xl sm:text-2xl font-black font-mono ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`}>≥98%</div>
              <div className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Target QC Compliance</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-3.5 rounded-xl border backdrop-blur-md spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)]/90 border-[var(--kt-s4)] hover:border-[var(--kt-info)]/50 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-blue-500/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`text-xl sm:text-2xl font-black font-mono ${isDark ? 'text-[var(--kt-info)]' : 'text-blue-700'}`}>42 / 20</div>
              <div className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Max CPL & CPS Rules</div>
            </div>
            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-3.5 rounded-xl border backdrop-blur-md spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)]/90 border-[var(--kt-s4)] hover:border-emerald-500/50 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-emerald-600/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`text-xl sm:text-2xl font-black font-mono ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>100%</div>
              <div className={`text-[11px] font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Local SQLite Sovereignty</div>
            </div>
          </div>

        </div>
      </section>

      {/* ── 3. Interactive Live Studio Simulator & Compliance QC ── */}
      <section id="simulator" className="scroll-mt-20 py-12 px-4 sm:px-8 max-w-5xl mx-auto w-full relative">
        <div id="compliance" className="absolute -top-20" />
        <div className="text-center mb-6">
          <h2 className={`text-xl sm:text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>Experience the Live QC Workstation Engine</h2>
          <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Interact with our subtitle rule engine below. Adjust CPL & CPS to see how real-time Netflix linting validates speech timing.
          </p>
        </div>

        {/* Mock Workstation Canvas with Dynamic Spotlight */}
        <div
          onMouseMove={handleMouseMoveCard}
          className={`border rounded-2xl shadow-2xl overflow-hidden spotlight-card transition-all ${
            isDark
              ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/40'
              : 'bg-white border-slate-200/90 shadow-slate-200/50 hover:border-blue-500/40'
          }`}
        >
          {/* Workstation Top Bar Mock */}
          <div className={`border-b px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
            isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className={`text-xs font-mono ml-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>demo_narration_24fps.mp4</span>
            </div>

            {/* Interactive Tabs */}
            <div className={`flex items-center gap-1 p-0.5 rounded-lg border text-xs ${
              isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-200/70 border-slate-300'
            }`}>
              <button
                type="button"
                onClick={() => setActiveTab('subtitle')}
                className={`px-3 py-1 rounded font-medium transition-all cursor-pointer ${
                  activeTab === 'subtitle'
                    ? (isDark ? 'bg-[var(--kt-s3)] text-white shadow-xs font-bold' : 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200/80')
                    : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
                }`}
              >
                Subtitle View
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('waveform')}
                className={`px-3 py-1 rounded font-medium transition-all cursor-pointer ${
                  activeTab === 'waveform'
                    ? (isDark ? 'bg-[var(--kt-s3)] text-white shadow-xs font-bold' : 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200/80')
                    : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
                }`}
              >
                Waveform Timeline
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('telemetry')}
                className={`px-3 py-1 rounded font-medium transition-all cursor-pointer ${
                  activeTab === 'telemetry'
                    ? (isDark ? 'bg-[var(--kt-s3)] text-white shadow-xs font-bold' : 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200/80')
                    : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
                }`}
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
                <div className={`border rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                  isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-mono font-bold ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`}>#01</span>
                      <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>00:01.200 → 00:03.450 (2.250s)</span>
                      <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-bold ${isCpsCompliant ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
                        {demoCps} CPS
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.2 rounded font-bold ${isCplCompliant ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'}`}>
                        {demoCpl} CPL
                      </span>
                    </div>
                    <p className={`text-sm font-medium font-sans leading-relaxed ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
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
                <div className={`border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 ${
                  isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div>
                    <div className={`flex justify-between text-xs font-semibold mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      <span>Reading Speed (CPS)</span>
                      <span className={`font-mono ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600 font-bold'}`}>{demoCps} CPS (Limit ≤ 20.0)</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="28"
                      step="0.2"
                      value={demoCps}
                      onChange={(e) => setDemoCps(parseFloat(e.target.value))}
                      className="w-full accent-[var(--kt-accent)] cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className={`flex justify-between text-xs font-semibold mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      <span>Characters Per Line (CPL)</span>
                      <span className={`font-mono ${isDark ? 'text-[var(--kt-info)]' : 'text-blue-700 font-bold'}`}>{demoCpl} CPL (Limit ≤ 42)</span>
                    </div>
                    <input
                      type="range"
                      min="25"
                      max="55"
                      step="1"
                      value={demoCpl}
                      onChange={(e) => setDemoCpl(parseInt(e.target.value, 10))}
                      className="w-full accent-[var(--kt-info)] cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'waveform' && (
              <div className="space-y-4 animate-tab-slide">
                {/* Simulated Audio Waveform with Moving Playhead */}
                <div className={`border rounded-xl p-5 relative overflow-hidden ${
                  isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className={`flex items-center justify-between mb-3 text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    <span className={`flex items-center gap-1.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600 font-semibold'}`}>
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
                        className={`w-full rounded-sm transition-all duration-300 ${
                          i >= 6 && i <= 22 
                            ? (isDark ? 'bg-[var(--kt-accent)]' : 'bg-blue-600') 
                            : (isDark ? 'bg-[var(--kt-s4)]' : 'bg-slate-300')
                        }`}
                      />
                    ))}
                    {/* Simulated Subtitle Region Overlay */}
                    <div className="absolute top-0 bottom-0 left-[20%] right-[30%] bg-[var(--kt-accent)]/15 border-x-2 border-[var(--kt-accent)] pointer-events-none rounded flex items-center justify-center">
                      <span className="text-[10px] font-mono font-bold text-white bg-black/60 px-2 py-0.5 rounded">
                        Active Subtitle Event [01:200 - 03:450]
                      </span>
                    </div>
                  </div>
                </div>
                <p className={`text-xs text-center ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Drag handles allow frame-level acoustic boundary snapping directly against speech pulses.
                </p>
              </div>
            )}

            {activeTab === 'telemetry' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-tab-slide">
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Temporal Alignment</div>
                  <div className={`text-lg font-bold font-mono ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`}>Frame-Accurate</div>
                  <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>Snaps to 24, 25, 29.97, & 30 FPS</div>
                </div>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Overlap Elimination</div>
                  <div className={`text-lg font-bold font-mono ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>0.000s Overlap</div>
                  <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>Automatic 2-frame min gap chaining</div>
                </div>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Diarization Engine</div>
                  <div className={`text-lg font-bold font-mono ${isDark ? 'text-[var(--kt-info)]' : 'text-blue-700'}`}>Multi-Speaker</div>
                  <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>Acoustic speaker turns & confidence</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 4. The Dual Studios Showcase ── */}
      <section id="studios" className="scroll-mt-20 py-16 px-4 sm:px-8 max-w-6xl mx-auto w-full">
        <div className="text-center mb-12">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3 border shadow-2xs ${
            isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-white border-slate-200 text-slate-700'
          }`}>
            <Layers className={`w-3.5 h-3.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`} />
            <span className="text-xs font-semibold">Choose Your Workstation</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl font-extrabold mb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            Two Specialized Production Suites
          </h2>
          <p className={`text-sm max-w-xl mx-auto ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Switch effortlessly between full conversational verbatim audio transcription and precision timed-text subtitle editing.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Card 1: Transcribe Studio with Dynamic 3D Spotlight */}
          <div
            onMouseMove={handleMouseMoveCard}
            className={`group rounded-2xl p-8 transition-all duration-300 flex flex-col justify-between spotlight-card tilt-card relative ${
              isDark
                ? 'bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] border border-[var(--kt-s4)] hover:border-[var(--kt-accent)] shadow-xl hover:shadow-[0_20px_50px_rgba(var(--kt-accent-rgb),0.16)]'
                : 'bg-white border border-slate-200/90 shadow-[0_4px_24px_rgba(0,0,0,0.04)] hover:border-blue-600/40 hover:shadow-[0_16px_36px_-6px_rgba(15,23,42,0.08)]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all duration-300 ${
                  isDark
                    ? 'bg-[var(--kt-s3)] border-[var(--kt-s4)] group-hover:border-[var(--kt-accent)]/50 text-[var(--kt-accent)] shadow-inner group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
                    : 'bg-blue-50 border-blue-200/80 text-[#2563eb] group-hover:scale-105 shadow-xs'
                }`}>
                  <Mic size={28} />
                </div>
                <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-md border uppercase ${
                  isDark
                    ? 'bg-[var(--kt-s3)] text-slate-400 border-[var(--kt-s4)] group-hover:border-[var(--kt-accent)]/30 group-hover:text-[var(--kt-accent)]'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}>
                  Acoustic Verbatim
                </span>
              </div>

              <h3 className={`text-2xl font-bold mb-2 transition-colors ${
                isDark ? 'text-white group-hover:text-[var(--kt-accent)]' : 'text-slate-900 group-hover:text-blue-600'
              }`}>Transcribe Studio</h3>
              <p className={`text-xs sm:text-sm mb-6 leading-relaxed ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}>
                Designed for transcriptionists and speech linguists. Deep acoustic diarization isolates individual speakers, flags hesitations, and validates accuracy.
              </p>

              <div className={`space-y-3 mb-8 text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`} />
                  <span><strong>Multi-Speaker Diarization</strong>: Automatic speaker classification with customizable names and colors.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`} />
                  <span><strong>Verbatim Guidelines Linter</strong>: Live verification against strict verbatim transcription standards.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`} />
                  <span><strong>Wide Format Ingestion</strong>: Lossless WAV, FLAC, MP3, M4A, OGG, and WebM.</span>
                </div>
              </div>
            </div>

            <div className={`pt-5 border-t flex items-center justify-between ${
              isDark ? 'border-[var(--kt-s3)]' : 'border-slate-100'
            }`}>
              <button
                onClick={() => handleLaunch('transcribe')}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  isDark
                    ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-accent)] text-white hover:text-black shadow-[0_0_15px_rgba(0,0,0,0.3)] hover:shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.4)]'
                    : 'bg-[var(--kt-s2)] hover:bg-slate-800 text-white shadow-xs hover:shadow-md'
                }`}
              >
                <span className="text-white">Launch Transcribe Studio</span>
                <ArrowRight size={14} className="text-white" />
              </button>
              <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>CSV · DOCX · SRT</span>
            </div>
          </div>

          {/* Card 2: Subtitle Studio with Dynamic 3D Spotlight */}
          <div
            onMouseMove={handleMouseMoveCard}
            className={`group rounded-2xl p-8 transition-all duration-300 flex flex-col justify-between spotlight-card tilt-card relative ${
              isDark
                ? 'bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] border border-[var(--kt-s4)] hover:border-[var(--kt-info)] shadow-xl hover:shadow-[0_20px_50px_rgba(var(--kt-accent-rgb),0.16)]'
                : 'bg-white border border-slate-200/90 shadow-[0_4px_24px_rgba(0,0,0,0.04)] hover:border-blue-600/40 hover:shadow-[0_16px_36px_-6px_rgba(15,23,42,0.08)]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center transition-all duration-300 ${
                  isDark
                    ? 'bg-[var(--kt-s3)] border-[var(--kt-s4)] group-hover:border-[var(--kt-info)]/50 text-[var(--kt-info)] shadow-inner group-hover:scale-110 group-hover:shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
                    : 'bg-blue-50 border-blue-200/80 text-[#0284c7] group-hover:scale-105 shadow-xs'
                }`}>
                  <Film size={28} />
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-1 rounded-md border uppercase ${
                  isDark
                    ? 'bg-[var(--kt-info)]/10 text-[var(--kt-info)] border-[var(--kt-info)]/30'
                    : 'bg-blue-50 text-[#0369a1] border-blue-200'
                }`}>
                  <Sparkles size={12} />
                  PRO NLE
                </span>
              </div>

              <h3 className={`text-2xl font-bold mb-2 transition-colors ${
                isDark ? 'text-white group-hover:text-[var(--kt-info)]' : 'text-slate-900 group-hover:text-blue-700'
              }`}>Subtitle Studio</h3>
              <p className={`text-xs sm:text-sm mb-6 leading-relaxed ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}>
                Professional broadcast subtitle workstation. Features synchronized video canvas, CapCut-style drag timeline, and automated Netflix compliance correction.
              </p>

              <div className={`space-y-3 mb-8 text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-info)]' : 'text-[#0284c7]'}`} />
                  <span><strong>Netflix Timed Text QC Engine</strong>: Auto-fixes CPS ≤20, CPL ≤42, and shot boundaries.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-info)]' : 'text-[#0284c7]'}`} />
                  <span><strong>Acoustic Waveform Snapping</strong>: Snaps subtitle in/out cues to actual speech audio onset energy.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-[var(--kt-info)]' : 'text-[#0284c7]'}`} />
                  <span><strong>Universal Deliverables</strong>: Export directly to Netflix TTML (DFXP/IMSC1.1), SRT, and VTT.</span>
                </div>
              </div>
            </div>

            <div className={`pt-5 border-t flex items-center justify-between ${
              isDark ? 'border-[var(--kt-s3)]' : 'border-slate-100'
            }`}>
              <button
                onClick={() => handleLaunch('subtitle')}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  isDark
                    ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] hover:shadow-[0_0_30px_rgba(var(--kt-accent-rgb),0.5)]'
                    : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-xs hover:shadow-md'
                }`}
              >
                <span className={isDark ? 'text-black' : 'text-white'}>Launch Subtitle Studio</span>
                <ArrowRight size={14} className={isDark ? 'text-black' : 'text-white'} />
              </button>
              <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>TTML · SRT · VTT</span>
            </div>
          </div>

        </div>
      </section>

      {/* ── 5. Enterprise Engine Architecture ── */}
      <section id="features" className={`scroll-mt-20 py-16 px-4 sm:px-8 border-y ${
        isDark ? 'bg-[var(--kt-s1)]/60 border-[var(--kt-s4)]' : 'bg-[#f1f5f9] border-slate-200'
      }`}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className={`text-2xl sm:text-3xl font-extrabold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              Engineered for Studio Quality
            </h2>
            <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Under the hood of Karya Studio's real-time speech processing pipeline.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-5 rounded-xl border spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/40 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-blue-500/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 border ${
                isDark
                  ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/30 text-[var(--kt-accent)] shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.2)]'
                  : 'bg-blue-50 border-blue-200 text-blue-700 shadow-2xs'
              }`}>
                <Cpu size={20} />
              </div>
              <h4 className={`text-base font-bold mb-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Gemini Flash Accuracy Model</h4>
              <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Multimodal speech-to-text pipeline captures nuances, colloquial phrases, and code-mixed dialogues like Hinglish with high fidelity.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-5 rounded-xl border spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-info)]/40 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-blue-500/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 border ${
                isDark
                  ? 'bg-[var(--kt-info)]/10 border-[var(--kt-info)]/30 text-[var(--kt-info)] shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.2)]'
                  : 'bg-blue-50 border-blue-200 text-blue-700 shadow-2xs'
              }`}>
                <Activity size={20} />
              </div>
              <h4 className={`text-base font-bold mb-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Acoustic Audio Sync</h4>
              <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Whisper + VAD acoustic speech onset detector re-anchors generated subtitles to audio waveforms, eliminating drift.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-5 rounded-xl border spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-emerald-500/40 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-emerald-600/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 border ${
                isDark
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.2)]'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-2xs'
              }`}>
                <ShieldCheck size={20} />
              </div>
              <h4 className={`text-base font-bold mb-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Netflix QC Linter</h4>
              <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Deterministic compliance auditing checks reading speeds (CPS), line lengths (CPL), and minimum shot gaps with auto-repair.
              </p>
            </div>

            <div
              onMouseMove={handleMouseMoveCard}
              className={`p-5 rounded-xl border spotlight-card tilt-card transition-all ${
                isDark
                  ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-amber-500/40 shadow-lg'
                  : 'bg-white border-slate-200 hover:border-amber-600/40 shadow-xs hover:shadow-md'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 border ${
                isDark
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                  : 'bg-amber-50 border-amber-200 text-amber-700 shadow-2xs'
              }`}>
                <Lock size={20} />
              </div>
              <h4 className={`text-base font-bold mb-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Sovereign SQLite</h4>
              <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                All accounts, session tokens, and drafts reside locally in your server's secure SQLite database without external cloud exposure.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. Supported Languages Matrix ── */}
      <section className="py-14 px-4 sm:px-8 max-w-5xl mx-auto w-full text-center">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3 border shadow-2xs ${
          isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-white border-slate-200 text-slate-700'
        }`}>
          <Globe size={14} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
          <span className="text-xs font-semibold">Global & Indic Localization</span>
        </div>
        <h2 className={`text-2xl sm:text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Support for 20+ Languages & Dialects
        </h2>
        <p className={`text-xs sm:text-sm max-w-lg mx-auto mb-8 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
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
              className={`px-3.5 py-1.5 rounded-xl text-xs transition-all duration-200 cursor-default shadow-xs border ${
                isDark
                  ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-300 hover:border-[var(--kt-accent)] hover:text-[var(--kt-accent)] hover:scale-105 hover:bg-[var(--kt-s3)]'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-blue-600 hover:text-blue-700 hover:scale-105 hover:bg-slate-50'
              }`}
            >
              {lang}
            </span>
          ))}
        </div>
      </section>

      {/* ── 7. Frequently Asked Questions (Interactive Search & Categories) ── */}
      <section id="faq" className={`scroll-mt-20 py-16 px-4 sm:px-8 border-t ${
        isDark ? 'bg-[var(--kt-s1)]/40 border-[var(--kt-s4)]' : 'bg-white border-slate-200'
      }`}>
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full mb-3 border shadow-2xs ${
              isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <HelpCircle size={14} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
              <span className="text-xs font-semibold">Knowledge Base & FAQ</span>
            </div>
            <h2 className={`text-2xl sm:text-3xl font-extrabold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              Frequently Asked Questions
            </h2>
            <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Everything you need to know about Karya Studio and its capabilities.
            </p>
          </div>

          {/* Interactive Search Bar & Category Filter Pills */}
          <div className="space-y-4 mb-6">
            <div className="relative">
              <Search size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
              <input
                type="text"
                value={faqSearchQuery}
                onChange={(e) => setFaqSearchQuery(e.target.value)}
                placeholder="Search FAQ questions (e.g. Netflix, audio, SQLite, rules)..."
                className={`w-full pl-10 pr-10 py-2.5 rounded-xl border text-xs sm:text-sm focus:outline-none transition-all shadow-inner ${
                  isDark
                    ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] focus:border-[var(--kt-accent)]/60 text-slate-200 placeholder-slate-500 focus:ring-1 focus:ring-[var(--kt-accent)]/40'
                    : 'bg-slate-50 border-slate-200 focus:border-blue-600 text-slate-800 placeholder-slate-400 focus:ring-1 focus:ring-blue-500/30'
                }`}
              />
              {faqSearchQuery && (
                <button
                  type="button"
                  onClick={() => setFaqSearchQuery('')}
                  className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold ${
                    isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'
                  }`}
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
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      faqCategory === cat
                        ? (isDark
                            ? 'bg-[var(--kt-accent)] text-black shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.35)]'
                            : 'bg-[#2563eb] text-white shadow-xs')
                        : (isDark
                            ? 'bg-[var(--kt-s2)] text-slate-400 hover:text-white border border-[var(--kt-s4)] hover:border-[#3a3b4e]'
                            : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300')
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
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
                    className={`rounded-xl border overflow-hidden transition-all spotlight-card ${
                      isOpen
                        ? (isDark
                            ? 'bg-[var(--kt-s2)] border-[var(--kt-accent)]/50 shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.12)]'
                            : 'bg-slate-50 border-blue-500/50 shadow-xs')
                        : (isDark
                            ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-slate-700'
                            : 'bg-white border-slate-200 hover:border-slate-300')
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className={`w-full text-left px-5 py-4 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold cursor-pointer group ${
                        isDark ? 'text-slate-200 hover:text-white' : 'text-slate-800 hover:text-blue-900'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border ${
                          isDark
                            ? 'bg-[var(--kt-s3)] text-[var(--kt-accent)] border-[var(--kt-s4)]'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          #{String(index + 1).padStart(2, '0')}
                        </span>
                        <span className={isDark ? 'group-hover:text-[var(--kt-accent)] transition-colors' : 'group-hover:text-blue-600 transition-colors'}>
                          {faq.q}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] hidden sm:inline-block font-mono uppercase px-2 py-0.5 rounded border ${
                          isDark ? 'bg-[var(--kt-s0)] text-slate-400 border-[var(--kt-s4)]' : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {faq.category}
                        </span>
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${
                            isOpen
                              ? (isDark ? 'rotate-180 text-[var(--kt-accent)]' : 'rotate-180 text-blue-600')
                              : (isDark ? 'text-slate-400 group-hover:text-slate-200' : 'text-slate-500 group-hover:text-slate-800')
                          }`}
                        />
                      </div>
                    </button>
                    {isOpen && (
                      <div className={`px-5 pb-4 text-xs sm:text-sm leading-relaxed border-t pt-3 animate-tab-slide ${
                        isDark ? 'border-[var(--kt-s3)] text-slate-300 bg-[var(--kt-s1)]/80' : 'border-slate-200 text-slate-600 bg-white/70'
                      }`}>
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className={`text-center py-10 border rounded-xl text-xs ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-400' : 'bg-white border-slate-200 text-slate-500'
              }`}>
                No matching questions found for "{faqSearchQuery}".
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 8. Call to Action Banner ── */}
      <section className="py-16 px-4 sm:px-8 max-w-4xl mx-auto w-full text-center">
        <div className={`p-8 sm:p-12 rounded-2xl border relative overflow-hidden shadow-2xl ${
          isDark
            ? 'bg-gradient-to-tr from-[var(--kt-s1)] via-[var(--kt-s2)] to-[var(--kt-s1)] border-[var(--kt-s4)]'
            : 'bg-gradient-to-br from-white via-slate-50 to-blue-50/20 border-slate-200 text-slate-900 shadow-xl'
        }`}>
          <div className={`absolute -top-20 -right-20 w-48 h-48 rounded-full blur-3xl pointer-events-none ${
            isDark ? 'bg-[var(--kt-accent)]/10' : 'bg-blue-500/10'
          }`} />
          <div className="mb-3 flex justify-center">
            <InteractiveEyeHeading
              text="Accelerate Your Localization Workflows Today"
              as="h2"
              className={`text-2xl sm:text-3xl font-extrabold text-center ${isDark ? 'text-white' : 'text-slate-900'}`}
            />
          </div>
          <p className={`text-xs sm:text-sm max-w-lg mx-auto mb-6 leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
            Join the VerboLabs team in producing broadcast-standard subtitles and verbatim transcripts faster than ever.
          </p>
          <button
            onClick={() => handleLaunch('subtitle')}
            className={`relative overflow-hidden group px-7 py-3.5 rounded-xl text-sm font-bold transition-all cursor-pointer inline-flex items-center gap-2 ${
              isDark
                ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.4)] hover:shadow-[0_0_45px_rgba(var(--kt-accent-rgb),0.65)]'
                : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md hover:shadow-blue-500/20'
            } hover:-translate-y-0.5 active:translate-y-0`}
          >
            <span className={isDark ? 'text-black' : 'text-white'}>Launch Workstation</span>
            <ArrowRight size={16} className={`transition-transform duration-200 group-hover:translate-x-1.5 ${isDark ? 'text-black' : 'text-white'}`} />
          </button>
        </div>
      </section>

      {/* ── 9. Footer ── */}
      <footer className={`border-t px-4 sm:px-8 py-8 text-center text-xs ${
        isDark ? 'border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-500' : 'border-slate-200 bg-[#f8fafc] text-slate-600'
      }`}>
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className={`font-bold ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>Karya Studio</span>
            <span>·</span>
            <span>VerboLabs Languages Pvt. Ltd.</span>
          </div>
          <div className={`flex items-center gap-2 text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
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
          className={`fixed bottom-6 right-6 z-50 p-3 rounded-full border backdrop-blur-xl transition-all duration-300 transform hover:-translate-y-1 active:translate-y-0 cursor-pointer animate-mac-squish flex items-center justify-center group overflow-hidden ${
            isDark
              ? 'bg-[var(--kt-s1)]/95 hover:bg-[var(--kt-s3)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/70 text-[var(--kt-accent)] hover:text-white shadow-[0_8px_25px_rgba(0,0,0,0.7),0_0_15px_rgba(var(--kt-accent-rgb),0.25)] hover:shadow-[0_8px_35px_rgba(0,0,0,0.9),0_0_30px_rgba(var(--kt-accent-rgb),0.5)]'
              : 'bg-white/95 hover:bg-slate-50 border-slate-300 hover:border-blue-500 text-blue-600 hover:text-blue-700 shadow-lg'
          }`}
          title="Back to Top"
          aria-label="Back to Top"
        >
          {/* Subtle pulsating glow ring */}
          <span className={`absolute inset-0 rounded-full animate-ping opacity-75 pointer-events-none ${
            isDark ? 'bg-[var(--kt-accent)]/20' : 'bg-blue-500/20'
          }`} />
          <ArrowUp size={18} className="relative z-10 transition-transform duration-200 group-hover:-translate-y-0.5" />
        </button>
      )}

    </div>
  );
}
