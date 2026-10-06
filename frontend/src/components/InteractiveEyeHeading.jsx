import React from 'react';

/**
 * 3D Wobble & Expansion Interactive Typography Component.
 * Letters dynamically expand, tilt, and wobble in 3D space with vibrant glow on cursor hover,
 * without any obstructive circular overlays or lens graphics.
 * Keeps entire words intact using inline-block whitespace-nowrap wrappers to prevent mid-word breaking.
 */
export default function InteractiveEyeHeading({
  text = '',
  highlightText = '',
  as = 'h1',
  className = '',
  highlightClassName = ''
}) {
  const renderInteractiveWord = (word, wordIdx, isHighlight = false) => {
    return (
      <span key={wordIdx} className="inline-block whitespace-nowrap">
        {word.split('').map((char, charIdx) => (
          <span
            key={charIdx}
            className={`inline-block transition-all duration-200 ease-out will-change-transform cursor-default ${
              isHighlight ? highlightClassName : ''
            }`}
            style={{
              transformStyle: 'preserve-3d',
              display: 'inline-block',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              const wobbleAngles = [-12, 12, -7, 7, -4, 4];
              const randomAngle = wobbleAngles[Math.floor(Math.random() * wobbleAngles.length)];
              el.style.transform = `perspective(600px) translateY(-7px) scale(1.22) rotate(${randomAngle}deg)`;
              const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('light');
              el.style.textShadow = isLight
                ? '0 2px 8px rgba(13, 148, 136, 0.35)'
                : (isHighlight
                    ? '0 0 20px rgba(var(--kt-accent-rgb),0.9), 2px 2px 0 rgba(var(--kt-accent-rgb),0.8), -2px -2px 0 rgba(244,63,94,0.5)'
                    : '0 0 16px rgba(var(--kt-accent-rgb),0.8), 2px 2px 0 rgba(168,85,247,0.7), -2px -2px 0 rgba(var(--kt-accent-rgb),0.7)');
              el.style.filter = isLight ? 'none' : 'drop-shadow(0 0 8px rgba(var(--kt-accent-rgb),0.7))';
              el.style.zIndex = '10';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.transform = 'perspective(600px) translateY(0) scale(1) rotate(0deg)';
              el.style.textShadow = '';
              el.style.filter = '';
              el.style.zIndex = '1';
            }}
          >
            {char}
          </span>
        ))}
      </span>
    );
  };

  const renderInteractiveLetters = (str, isHighlight = false) => {
    const words = str.split(' ');
    return words.map((word, idx) => (
      <React.Fragment key={idx}>
        {renderInteractiveWord(word, idx, isHighlight)}
        {idx < words.length - 1 && ' '}
      </React.Fragment>
    ));
  };

  const HeadingTag = as;

  return (
    <div className="relative inline-block select-none max-w-full">
      <HeadingTag className={className}>
        {renderInteractiveLetters(text, false)}
        {highlightText && (
          <>
            {' '}
            {renderInteractiveLetters(highlightText, true)}
          </>
        )}
      </HeadingTag>
    </div>
  );
}
