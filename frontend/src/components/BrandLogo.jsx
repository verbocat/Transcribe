import React from 'react';

const BASE = '/brand/';

/**
 * Lower Third brand marks. `mark` is the round play icon, `wordmark` is the full logo with the
 * tagline (light version, for the app's dark surfaces). Size is the rendered height in px.
 */
export default function BrandLogo({ variant = 'mark', size = 28, className = '', style }) {
  if (variant === 'wordmark') {
    return (
      <img
        src={`${BASE}lowerthird-logo-light.png`}
        alt="Lower Third"
        draggable={false}
        className={className}
        style={{ height: size, width: 'auto', display: 'block', ...style }}
      />
    );
  }
  return (
    <img
      src={`${BASE}${size > 64 ? 'lowerthird-icon-192' : 'lowerthird-icon-64'}.png`}
      alt="Lower Third"
      draggable={false}
      className={className}
      style={{ width: size, height: size, display: 'block', flexShrink: 0, ...style }}
    />
  );
}
