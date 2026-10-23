import React from 'react';
import BrandLogo from '../components/BrandLogo';
import CaptionStage from '../components/CaptionStage';

const COPY = {
  signup: {
    title: 'Start with your first file.',
    body: 'Transcribe speech, build subtitles and dub into new languages from one workspace.',
  },
  default: {
    title: 'Every word, timed and translated.',
    body: 'Transcripts, broadcast-ready subtitles and dubs for Hindi and the languages around it.',
  },
};

/** Brand panel beside the sign-in form (large screens only). */
export default function AuthSplitVisual({ activeView = 'login' }) {
  const copy = activeView === 'signup' ? COPY.signup : COPY.default;
  return (
    <aside className="nx-auth-art">
      <BrandLogo variant="wordmark" size={34} className="self-start" />
      <div className="flex flex-col gap-8 py-10">
        <div className="max-w-md">
          <h2 className="nx-display text-[40px] xl:text-[46px] leading-[1.04] font-semibold text-white">{copy.title}</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[#c9d0ee]">{copy.body}</p>
        </div>
        <CaptionStage />
      </div>
      <p className="text-xs text-[#8f99c4]">Noun by VerboLabs</p>
    </aside>
  );
}
