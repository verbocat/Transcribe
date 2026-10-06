import React, { Suspense, lazy, useEffect, useState } from 'react';
import { OPEN_EVENT } from './themeEngine';

// Loaded on first open so the dashboard costs nothing at start-up
const ThemeDashboard = lazy(() => import('./ThemeDashboard'));

/** Mounted once at the app root. Anything can open it with openAppearance(). */
export default function AppearanceHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ThemeDashboard onClose={() => setOpen(false)} />
    </Suspense>
  );
}
