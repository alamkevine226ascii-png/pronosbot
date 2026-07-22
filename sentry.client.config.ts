// Sentry client config — ONLY activates if NEXT_PUBLIC_SENTRY_DSN is set in .env
// If not set, this file is a no-op (no errors sent, no performance impact).

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1, // 10% of transactions traced
    profilesSampleRate: 0.1,
    environment: process.env.NODE_ENV,
    // Filter out noisy errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Network request failed',
    ],
  });
}
