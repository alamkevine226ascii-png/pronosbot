'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Lock, LogIn, UserPlus } from 'lucide-react';

interface AccessGateProps {
  children: React.ReactNode;
}

/**
 * Garde d'accès — exige une CONNEXION (session NextAuth).
 * Aucun code en clair, aucun stockage local : l'accès dépend uniquement
 * de la session serveur sécurisée. Si l'utilisateur n'est pas connecté,
 * on affiche un écran avec deux actions : Se connecter / Créer un compte.
 */
export function AccessGate({ children }: AccessGateProps) {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Session en cours de chargement → rien tant qu'on ne sait pas.
  if (status === 'loading') {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#0A0A0A]">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00] border-t-transparent" />
      </div>
    );
  }

  // Connecté → rend l'app.
  if (status === 'authenticated' && session?.user) {
    return <>{children}</>;
  }

  // Non connecté → écran d'accès.
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0A0A0A] px-4">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ backgroundColor: '#00FF00' }}
        aria-hidden
      />
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
        {/* Logo */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#00FF00]/30 bg-[#00FF00]/10"
            style={{ boxShadow: '0 0 24px rgba(0,255,0,0.3)' }}
          >
            <Lock className="h-8 w-8 text-[#00FF00]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            PRONO<span className="text-[#00FF00]" style={{ textShadow: '0 0 12px rgba(0,255,0,0.5)' }}>BOT</span>
          </h1>
          <p className="mt-1.5 text-xs text-zinc-500">
            Connectez-vous pour accéder aux pronostics
          </p>
        </div>

        {/* Boutons */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => router.push('/auth/signin')}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00FF00] py-4 text-sm font-black uppercase tracking-wider text-black transition-all hover:bg-[#00CC00]"
            style={{ boxShadow: '0 0 20px rgba(0,255,0,0.4)' }}
          >
            <LogIn className="h-4 w-4" />
            Se connecter
          </button>
          <button
            type="button"
            onClick={() => router.push('/auth/register')}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#00FF00]/40 bg-[#00FF00]/10 py-4 text-sm font-black uppercase tracking-wider text-[#00FF00] transition-all hover:bg-[#00FF00]/20"
          >
            <UserPlus className="h-4 w-4" />
            Créer un compte
          </button>
        </div>

        <p className="mt-8 text-center text-[10px] text-zinc-700">
          PronoBot · Accès par compte sécurisé
        </p>
      </motion.div>
    </div>
  );
}