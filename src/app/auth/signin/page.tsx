'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Lock, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Email ou mot de passe incorrect.');
        return;
      }

      // Connexion réussie → forcer la redirection vers l'accueil
      // (result?.url peut renvoyer '/auth/signin' avec redirect:false, on ignore).
      router.push('/');
      router.refresh();
    } catch {
      setError('Erreur de réseau. Réessayez.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0A0A0A] px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00FF00]/30 bg-[#00FF00]/10"
            style={{ boxShadow: '0 0 24px rgba(0,255,0,0.3)' }}
          >
            <Lock className="h-7 w-7 text-[#00FF00]" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Connexion</h1>
          <p className="mt-1.5 text-xs text-zinc-500">Accédez à votre compte PronoBot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414]/80 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all focus:border-[#00FF00]/60"
          />
          <input
            type="password"
            required
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414]/80 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all focus:border-[#00FF00]/60"
          />

          {error && (
            <p className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00FF00] py-3.5 text-sm font-black uppercase tracking-wider text-black transition-all hover:bg-[#00CC00] disabled:cursor-not-allowed disabled:bg-[#333333] disabled:text-zinc-600"
            style={!loading ? { boxShadow: '0 0 20px rgba(0,255,0,0.4)' } : undefined}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connexion...
              </>
            ) : (
              <>
                Se connecter
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Pas de compte ?{' '}
          <Link href="/auth/register" className="font-bold text-[#00FF00] hover:underline">
            Créer un compte
          </Link>
        </p>
      </motion.div>
    </div>
  );
}