// Next.js instrumentation hook.
// Sentry is loaded only if SENTRY_DSN is set — otherwise this is a no-op.
// Wrapped in try/catch to never block the server from starting.
export async function register() {
  try {
    if (process.env.SENTRY_DSN) {
      if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
        await import('./sentry.server.config');
      }
    }
  } catch {
    // Sentry failed to load — don't block the app
  }
}
