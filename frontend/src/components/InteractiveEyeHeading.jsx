import React from 'react';

/**
 * 3D Wobble & Expansion Interactive Typography Component.
 * Letters dynamically expand, tilt, and wobble in 3D space with vibrant glow on cursor hover,
 * without any obstructive circular overlays or lens graphics.
 */
export default function InteractiveEyeHeading({
  text = '',
  highlightText = '',
  as = 'h1',
  className = '',
  highlightClassName = ''
}) {
  const renderInteractiveLetters = (str, isHighlight = false) => {
    return str.split('').map((char, index) => {
      if (char === ' ') {
        return <span key={index}> </span>;
      }

      return (
        <span
          key={index}
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
            el.style.textShadow = isHighlight
              ? '0 0 20px rgba(0,229,190,0.9), 2px 2px 0 rgba(0,201,255,0.8), -2px -2px 0 rgba(244,63,94,0.5)'
              : '0 0 16px rgba(0,229,190,0.8), 2px 2px 0 rgba(168,85,247,0.7), -2px -2px 0 rgba(0,201,255,0.7)';
            el.style.filter = 'drop-shadow(0 0 8px rgba(0,229,190,0.7))';
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
      );
    });
  };

  const HeadingTag = as;

  return (
    <div className="relative inline-block select-none">
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
