'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, Check } from 'lucide-react';

const CONSENT_KEY = 'pronobot_cookie_consent';
const CONSENT_VERSION = 'v1'; // bump if policy changes

interface Consent {
  version: string;
  timestamp: number;
  essential: boolean; // always true
  analytics: boolean;
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONSENT_KEY);
      if (raw) {
        const consent: Consent = JSON.parse(raw);
        if (consent.version === CONSENT_VERSION) return; // already consented
      }
    } catch {
      /* localStorage unavailable — ignore */
    }
    // Show banner after 2s delay
    const t = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const saveConsent = (analytics: boolean) => {
    const consent: Consent = {
      version: CONSENT_VERSION,
      timestamp: Date.now(),
      essential: true,
      analytics,
    };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      /* localStorage unavailable — ignore */
    }
    setVisible(false);
    // If analytics accepted, could load analytics scripts here
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed left-0 right-0 z-[90] p-4"
          style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-md rounded-xl border border-[#00FF00]/30 bg-[#0A0A0A]/95 p-4 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/10">
                <Cookie className="h-4 w-4 text-[#00FF00]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">Cookies &amp; confidentialité</p>
                <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                  PronoBot utilise des cookies essentiels (cache, préférences) et optionnels
                  (analytics) pour améliorer l&apos;app. Aucune donnée personnelle n&apos;est revendue.
                  Voir la section « Confidentialité (RGPD) » dans l&apos;onglet Profil.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => saveConsent(false)}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    Refuser
                  </button>
                  <button
                    type="button"
                    onClick={() => saveConsent(true)}
                    className="flex-1 rounded-lg bg-[#00FF00] px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-[#00CC00]"
                  >
                    <Check className="mr-1 inline h-3 w-3" />
                    Accepter
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
