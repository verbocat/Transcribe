import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, ExternalLink, AlertTriangle, CheckCircle2, X, Sparkles } from 'lucide-react';

export default function ElevenLabsApiKeyModal({
  isOpen,
  onClose,
  onSave,
  errorMessage = null,
  initialKey = ''
}) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(true);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('elevenlabs_api_key') || initialKey || '';
      setApiKey(stored);
      setValidationError('');
    }
  }, [isOpen, initialKey]);

  if (!isOpen) return null;

  const handleSaveAndContinue = (e) => {
    e.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setValidationError('Please enter a valid API key.');
      return;
    }

    if (rememberKey) {
      localStorage.setItem('elevenlabs_api_key', cleanKey);
    } else {
      localStorage.removeItem('elevenlabs_api_key');
    }

    onSave(cleanKey);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--ss-line)] bg-[var(--ss-panel)] shadow-2xl overflow-hidden text-slate-200 animate-mac-squish">
        {/* Header */}
        <div className="p-5 border-b border-[var(--ss-line)] bg-[var(--ss-raised)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[var(--ss-accent)]/15 text-[var(--ss-accent)] border border-[var(--ss-accent)]/30">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Speech Engine API Key Required</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--ss-accent)]/20 text-[var(--ss-accent)] border border-[var(--ss-accent)]/40 font-semibold">
                  Speech-to-text
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Connect your account for full-file multilingual speech-to-text
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--ss-hover)] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSaveAndContinue} className="p-5 space-y-4">
          {/* Error Banner if API returned error */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Transcription Error:</span>
                <span className="text-rose-200/90">{errorMessage}</span>
              </div>
            </div>
          )}

          <div className="text-xs text-slate-300 leading-relaxed">
            The studio uses <span className="text-[var(--ss-accent)] font-semibold">speech-to-text engine</span> for word-level acoustic synchronization and diarization across 90+ languages, without batch chunking or Whisper.
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-200">API Key</label>
              <a
                href="https://elevenlabs.io/app/settings/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--ss-accent)] hover:underline flex items-center gap-1 font-medium text-[11px]"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                placeholder="sk_..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (validationError) setValidationError('');
                }}
                className={`w-full px-3.5 py-2.5 pr-10 rounded-xl text-xs font-mono bg-[var(--kt-s0)] border ${
                  validationError ? 'border-rose-500' : 'border-[var(--kt-s5)] focus:border-[var(--ss-accent)]'
                } text-white placeholder-slate-500 focus:outline-none transition-colors`}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {validationError && (
              <p className="text-[11px] text-rose-400 font-medium">{validationError}</p>
            )}
          </div>

          {/* Remember Key Checkbox */}
          <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => setRememberKey(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--ss-accent)] cursor-pointer"
            />
            <span>Remember API key in this browser (localStorage)</span>
          </label>

          {/* Info note */}
          <div className="p-3 rounded-xl bg-[var(--ss-raised)] border border-[var(--ss-line)] text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-[var(--ss-accent)]" />
              <span>How your key is used:</span>
            </div>
            <p>
              Your key is passed only with your audio transcription requests and is never stored on our external servers. You can also configure it globally via <code className="text-[var(--ss-accent)]">ELEVENLABS_API_KEY</code> in backend <code className="text-[var(--ss-accent)]">.env</code>.
            </p>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[var(--ss-line)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-[var(--ss-hover)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold bg-[var(--ss-accent)] hover:bg-[var(--ss-accent-hover)] text-black shadow-md shadow-[var(--ss-accent)]/20 transition-all cursor-pointer flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Save & Start Generation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
