'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegister — registers /sw.js on the client after the page loads.
 *
 * Replaces the previous inline `<script dangerouslySetInnerHTML>` in layout.tsx.
 * The inline script was hardcoded (no XSS vector), but using a React client
 * component is the modern Next.js best practice: it keeps the CSP cleaner
 * (no `unsafe-inline` needed for this script), is testable, and avoids the
 * `dangerouslySetInnerHTML` lint warning.
 *
 * The SW itself is registered with scope '/' so it controls the whole app —
 * required for PWA offline support. The SW file (/public/sw.js) only caches
 * same-origin GET requests (POST/PUT/etc. are passed through), so no sensitive
 * data (e.g. /api/web-search responses) is ever cached.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // Register only in production — in dev, the SW can cache stale chunks and
    // break HMR. (Next.js dev server already sets no-cache headers, but the SW
    // would override them for navigations.)
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.log('[PWA] SW enregistré', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Erreur SW:', err);
        });
    };

    // Defer registration until after the page is fully loaded so it doesn't
    // compete with first-paint critical work.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
