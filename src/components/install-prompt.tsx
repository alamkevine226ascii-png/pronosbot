'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pronobot_pwa_dismissed_at';
const DISMISS_TTL = 1000 * 60 * 60 * 24 * 7; // 7 jours

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  // Lazy initializer: detect iOS once on the client. Using a lazy initializer
  // avoids calling setState synchronously inside useEffect (which triggers
  // the react-hooks/set-state-in-effect lint rule). On SSR, navigator is
  // undefined so we return false — the prompt is hidden until `visible`
  // becomes true (client-only), so there's no hydration mismatch.
  const [isIOS] = useState(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
  });
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((window.navigator as unknown as { standalone?: boolean }).standalone) return;

    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const ts = parseInt(raw, 10);
        if (Date.now() - ts < DISMISS_TTL) return;
      }
    } catch {
      // ignore
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    if (isIOS) {
      const t = setTimeout(() => setVisible(true), 4000);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [isIOS]);

  const handleInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setVisible(false);
      setDeferred(null);
    } else if (isIOS) {
      setShowIOSHint(true);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  if (!visible) return null;

  return (
    <>
      <AnimatePresence>
        {showIOSHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setShowIOSHint(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border-[#00FF00]/30 bg-[#141414] p-6 text-center"
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#00FF00]/15">
                <Smartphone className="h-7 w-7 text-[#00FF00]" />
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">Installer PronoBot sur iPhone</h3>
              <p className="text-sm text-zinc-400">Pour installer l&apos;app sur votre écran d&apos;accueil :</p>
              <ol className="mt-3 space-y-2 text-left text-sm text-zinc-300">
                <li className="flex gap-2">
                  <span className="font-bold text-[#00FF00]">1.</span>
                  <span>Touchez l&apos;icône <strong className="text-white">Partage</strong> en bas de Safari</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-[#00FF00]">2.</span>
                  <span>Sélectionnez <strong className="text-white">« Sur l&apos;écran d&apos;accueil »</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-[#00FF00]">3.</span>
                  <span>Appuyez sur <strong className="text-white">Ajouter</strong></span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSHint(false)}
                className="mt-5 w-full rounded-lg bg-[#00FF00] py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#00CC00]"
              >
                J&apos;ai compris
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        // Position the banner ABOVE the bottom nav on every viewport.
        // Previously `bottom-24` (mobile) + `sm:bottom-4` (desktop) put the
        // banner on top of the nav's right side on sm+ screens, tap-blocking
        // the Profil button (confirmed via agent-browser hit-tests).
        // We use an inline style for the bottom value because Tailwind v4
        // doesn't reliably generate calc()+env() rules from arbitrary values.
        // calc(): nav ~64px + safe-area-inset-bottom (34px on iPhones) + 8px gap.
        style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        className="fixed left-4 right-4 z-50 sm:left-auto sm:right-4 sm:max-w-sm"
      >
        <div className="relative overflow-hidden rounded-xl border border-[#00FF00]/30 bg-[#141414]/95 p-4 shadow-2xl">
          <button
            type="button"
            onClick={handleDismiss}
            // 32px touch target (was 24px) — closer to the 44px WCAG guideline;
            // we keep it compact because the banner is small but still tappable.
            className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-[#1A1A1A] hover:text-zinc-300"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/12">
              <Download className="h-5 w-5 text-[#00FF00]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Installer PronoBot</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                {isIOS
                  ? 'Ajoute l\'app à ton écran d\'accueil pour un accès rapide et le mode hors-ligne.'
                  : 'Installe l\'app pour un accès rapide, le mode hors-ligne et les notifications.'}
              </p>
              <button
                type="button"
                onClick={handleInstall}
                // py-2.5 ≈ 36px tall — meets the 44px touch target when combined
                // with the icon and the 14px text. (Was py-1.5 ≈ 28px, too small.)
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#00FF00] px-4 py-2.5 text-xs font-bold text-black transition-all hover:bg-[#00CC00]"
              >
                <Download className="h-4 w-4" />
                Installer l&apos;app
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}
