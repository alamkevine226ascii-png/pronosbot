'use client';

import { useState, FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ArrowRight, AlertCircle } from 'lucide-react';

const ACCESS_CODE = '230409';
const STORAGE_KEY = 'pronobot_access_granted';

interface AccessGateProps {
  children: React.ReactNode;
}

export function AccessGate({ children }: AccessGateProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // Check localStorage on mount — avoids flash of login screen
  // Lazy initializer avoids the react-hooks/set-state-in-effect lint rule
  const [granted, setGranted] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim() === ACCESS_CODE) {
      setGranted(true);
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        // localStorage blocked — session only
      }
    } else {
      setError(true);
      setAttempts((a) => a + 1);
      setCode('');
      // Clear error after 2s
      setTimeout(() => setError(false), 2000);
    }
  };

  // Access granted — render the app
  if (granted) {
    return <>{children}</>;
  }

  // Access gate — code entry screen
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0A0A0A] px-4">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ backgroundColor: '#00FF00' }}
        aria-hidden
      />

      {/* Grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#00FF00 1px, transparent 1px), linear-gradient(90deg, #00FF00 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative w-full max-w-sm"
      >
        {/* Logo / Icon */}
        <div className="mb-8 text-center">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#00FF00]/30 bg-[#00FF00]/10"
            style={{ boxShadow: '0 0 24px rgba(0,255,0,0.3)' }}
          >
            <Lock className="h-8 w-8 text-[#00FF00]" />
          </motion.div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            PRONO<span className="text-[#00FF00]" style={{ textShadow: '0 0 12px rgba(0,255,0,0.5)' }}>BOT</span>
          </h1>
          <p className="mt-1.5 text-xs text-zinc-500">
            Accès restreint — Entrez votre code d'accès
          </p>
        </div>

        {/* Code entry form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(false);
              }}
              placeholder="• • • • • •"
              maxLength={6}
              className={`w-full rounded-xl border bg-[#141414]/80 px-4 py-4 text-center text-2xl font-mono font-black tracking-[0.5em] text-white placeholder-zinc-700 outline-none transition-all ${
                error
                  ? 'border-red-500/60 bg-red-500/5'
                  : 'border-[#2A2A2A] focus:border-[#00FF00]/60'
              }`}
              style={
                error
                  ? undefined
                  : { boxShadow: code ? '0 0 16px rgba(0,255,0,0.15)' : undefined }
              }
              aria-label="Code d'accès"
            />
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute -bottom-7 left-0 right-0 flex items-center justify-center gap-1.5 text-xs font-bold text-red-400"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  {attempts >= 3
                    ? 'Code incorrect — Accès refusé'
                    : 'Code incorrect — Réessayez'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="submit"
            disabled={code.length < 4}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#00FF00] py-4 text-sm font-black uppercase tracking-wider text-black transition-all hover:bg-[#00CC00] disabled:cursor-not-allowed disabled:bg-[#333333] disabled:text-zinc-600"
            style={code.length >= 4 ? { boxShadow: '0 0 20px rgba(0,255,0,0.4)' } : undefined}
          >
            Accéder à l'app
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </button>
        </form>

        {/* Footer hint */}
        <p className="mt-8 text-center text-[10px] text-zinc-700">
          PronoBot v2.5.1 · Accès sécurisé
        </p>
      </motion.div>
    </div>
  );
}
