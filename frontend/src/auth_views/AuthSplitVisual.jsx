import React, { useState } from 'react';
import { Sparkles, ShieldCheck, Zap, Headphones, ArrowRight, ArrowLeft } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function AuthSplitVisual({ activeView = 'login' }) {
  const { isDark } = useTheme();
  const [slideIndex, setSlideIndex] = useState(0);

  const slides = [
    {
      title: "Finally, all your work in one place.",
      desc: "High-precision verbatim speech segmentation & multi-batch automation.",
      tag: "Live Acoustic Processing",
      badge1: { icon: Zap, text: "0.05s Waveform Sync" },
      badge2: { icon: ShieldCheck, text: "Netflix QC Guard" }
    },
    {
      title: "Broadcast-Ready Compliance Engine",
      desc: "Automated Reading Speed (CPS ≤ 20) and Line Length (CPL ≤ 42) validation.",
      tag: "Netflix Timed Text Standard",
      badge1: { icon: ShieldCheck, text: "Auto Linter Audit" },
      badge2: { icon: Zap, text: "Shot Boundary Snapping" }
    },
    {
      title: "Acoustic AI Speech Diarization",
      desc: "Gemini accuracy model coupled with onset edge detectors for zero-gap timing.",
      tag: "Dual-Engine Architecture",
      badge1: { icon: Sparkles, text: "Multi-Speaker Align" },
      badge2: { icon: Headphones, text: "Lossless Audio Sync" }
    }
  ];

  const currentSlide = slides[slideIndex];
  const Badge1Icon = currentSlide.badge1.icon;
  const Badge2Icon = currentSlide.badge2.icon;

  const handlePrev = () => {
    setSlideIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setSlideIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className={`relative hidden lg:flex flex-col justify-between p-6 xl:p-8 w-full lg:w-[46%] overflow-hidden rounded-3xl m-2 transition-all duration-350 select-none ${
      isDark
        ? 'bg-gradient-to-br from-[var(--kt-s2)] via-[var(--kt-s2)] to-[var(--kt-s0)] border border-[var(--kt-s5)]'
        : 'bg-gradient-to-br from-[#e8f0fe] via-[#f0f4fc] to-[#e4edf9] border border-[#d2ddec]'
    }`}>
      {/* Ambient acoustic glows */}
      <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[var(--kt-accent)]/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-indigo-500/15 blur-3xl pointer-events-none" />

      {/* Top Tagline / Pill */}
      <div className="relative z-10 flex items-center justify-between">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold border ${
          isDark
            ? 'bg-[var(--kt-s3)]/80 border-[#32364e] text-[var(--kt-accent)]'
            : 'bg-white/80 border-[#cbd5e1] text-blue-700 shadow-xs'
        }`}>
          <Sparkles size={13} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
          <span>Lower Third</span>
        </div>
        <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>Subtitle & Transcription Studio</span>
      </div>

      {/* Center Artwork: Studio Soundscape Deck */}
      <div className="relative z-10 my-auto py-4 flex flex-col items-center justify-center text-center">
        {/* Rounded Glass Frame with Soundwave Visual */}
        <div className={`relative w-full max-w-[300px] aspect-[4/3] rounded-2xl p-4 flex flex-col items-center justify-center border shadow-xl overflow-hidden backdrop-blur-md transition-all duration-350 ${
          isDark
            ? 'bg-[var(--kt-s2)]/70 border-[var(--kt-s5)] shadow-black/40'
            : 'bg-white/85 border-[#d8e0ed] shadow-slate-300/40'
        }`}>
          {/* Subtle concentric soundwave circles */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <div className="w-44 h-44 rounded-full border border-[var(--kt-accent)] animate-ping [animation-duration:4s]" />
            <div className="w-32 h-32 rounded-full border border-blue-400" />
            <div className="w-20 h-20 rounded-full border border-indigo-400" />
          </div>

          {/* Central Acoustic Icon Badge */}
          <div className={`relative w-14 h-14 rounded-2xl flex items-center justify-center font-black shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.35)] mb-3 ${
            isDark
              ? 'bg-gradient-to-tr from-[var(--kt-accent)] to-blue-600 text-black'
              : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-blue-500/25'
          }`}>
            <Headphones size={26} className="stroke-[2.2]" />
          </div>

          {/* Dynamic Graphic Spectrum Bars */}
          <div className="flex items-center gap-1.5 h-8 mb-2">
            {[40, 75, 55, 90, 60, 100, 70, 85, 45, 95, 65, 80, 50].map((h, i) => (
              <span
                key={i}
                style={{ height: `${h}%` }}
                className={`w-1.5 rounded-full transition-all duration-300 ${
                  isDark
                    ? 'bg-gradient-to-t from-blue-500 to-[var(--kt-accent)]'
                    : 'bg-gradient-to-t from-blue-600 to-blue-400'
                }`}
              />
            ))}
          </div>

          <div className={`text-[10.5px] font-mono font-bold tracking-wider uppercase mt-1 ${
            isDark ? 'text-slate-300' : 'text-slate-700'
          }`}>
            {currentSlide.tag}
          </div>
        </div>

        {/* Feature Badges Grid */}
        <div className="grid grid-cols-2 gap-2 mt-4 w-full max-w-[300px]">
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold text-left transition-all ${
            isDark ? 'bg-[var(--kt-s2)]/60 border-[var(--kt-s4)] text-slate-300' : 'bg-white/80 border-[#d8e0ed] text-slate-700 shadow-2xs'
          }`}>
            <Badge1Icon size={13} className={isDark ? 'text-[var(--kt-accent)] shrink-0' : 'text-blue-600 shrink-0'} />
            <span className="truncate">{currentSlide.badge1.text}</span>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold text-left transition-all ${
            isDark ? 'bg-[var(--kt-s2)]/60 border-[var(--kt-s4)] text-slate-300' : 'bg-white/80 border-[#d8e0ed] text-slate-700 shadow-2xs'
          }`}>
            <Badge2Icon size={13} className="text-emerald-500 shrink-0" />
            <span className="truncate">{currentSlide.badge2.text}</span>
          </div>
        </div>
      </div>

      {/* Bottom Inspiration Quote & Interactive Carousel Controls */}
      <div className={`relative z-10 pt-3 border-t border-dashed flex items-center justify-between transition-all ${
        isDark ? 'border-slate-700/40' : 'border-slate-300/70'
      }`}>
        <div className="text-left flex-1 min-w-0 pr-2">
          <div className={`font-bold text-xs sm:text-sm leading-snug transition-all ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {currentSlide.title}
          </div>
          <div className={`text-[11px] mt-0.5 leading-tight transition-all line-clamp-2 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {currentSlide.desc}
          </div>
        </div>

        {/* Working interactive carousel nav buttons */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous slide"
            className={`w-7 h-7 rounded-full border flex items-center justify-center cursor-pointer transition-all hover:scale-110 active:scale-95 ${
              isDark
                ? 'border-[var(--kt-s5)] text-slate-300 hover:text-white hover:border-[var(--kt-accent)]/50 hover:bg-[var(--kt-s3)]'
                : 'border-[#cbd5e1] text-slate-700 hover:text-slate-900 hover:border-blue-500/50 hover:bg-white shadow-2xs'
            }`}
          >
            <ArrowLeft size={12} />
          </button>

          {/* Dot Indicators */}
          <div className="flex items-center gap-1 px-1">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSlideIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  slideIndex === i
                    ? (isDark ? 'w-3.5 bg-[var(--kt-accent)]' : 'w-3.5 bg-blue-600')
                    : (isDark ? 'w-1.5 bg-slate-600 hover:bg-slate-400' : 'w-1.5 bg-slate-300 hover:bg-slate-500')
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleNext}
            aria-label="Next slide"
            className={`w-7 h-7 rounded-full border flex items-center justify-center cursor-pointer transition-all hover:scale-110 active:scale-95 ${
              isDark
                ? 'border-[var(--kt-s5)] text-slate-300 hover:text-white hover:border-[var(--kt-accent)]/50 hover:bg-[var(--kt-s3)]'
                : 'border-[#cbd5e1] text-slate-700 hover:text-slate-900 hover:border-blue-500/50 hover:bg-white shadow-2xs'
            }`}
          >
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
