import React from 'react';

const BASE = '/brand/';

/**
 * Noun brand marks. `mark` is the round play icon, `wordmark` is the full logo with the
 * tagline (white version, for the app's dark surfaces). Size is the rendered height in px.
 */
export default function BrandLogo({ variant = 'mark', size = 28, className = '', style }) {
  if (variant === 'wordmark') {
    return (
      <img
        src={`${BASE}noun-logo-dark.png`}
        alt="Noun"
        draggable={false}
        className={className}
        style={{ height: size, width: 'auto', display: 'block', ...style }}
      />
    );
  }
  return (
    <img
      src={`${BASE}${size > 64 ? 'noun-mark-192' : 'noun-mark-64'}.png`}
      alt="Noun"
      draggable={false}
      className={className}
      style={{ width: size, height: size, display: 'block', flexShrink: 0, ...style }}
    />
  );
}
