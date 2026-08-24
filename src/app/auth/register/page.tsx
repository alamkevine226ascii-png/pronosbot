'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { Lock, Mail, AlertCircle, Loader2, ArrowRight } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères.');
      return;
    }

    setLoading(true);
    try {
      // 1) Créer le compte via /api/register
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name.trim() || undefined }),
      });
      const data = await resp.json().catch(() => ({ error: 'Erreur réseau' }));

      if (!resp.ok) {
        setError(data?.error || 'Inscription impossible.');
        return;
      }

      // Réponse neutre anti-énumération : si user === null, l'email existe
      // peut-être déjà — on affiche le même message que pour un succès partiel.
      if (data?.user === null) {
        setError(data?.message || "Vérifie ta boîte mail pour confirmer l'inscription.");
        setTimeout(() => router.push('/auth/signin'), 1500);
        return;
      }

      // 2) Connecter automatiquement le nouvel utilisateur
      const signRes = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (signRes?.error) {
        // Compte créé mais connexion auto échouée → redirige vers la connexion.
        setError('Compte créé. Connectez-vous.');
        setTimeout(() => router.push('/auth/signin'), 1200);
        return;
      }

      // 3) Rediriger vers l'app
      router.push('/');
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
          <h1 className="text-2xl font-black tracking-tight text-white">Créer un compte</h1>
          <p className="mt-1.5 text-xs text-zinc-500">Rejoignez PronoBot</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Nom (optionnel)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414]/80 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all focus:border-[#00FF00]/60"
          />
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414]/80 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all focus:border-[#00FF00]/60"
          />
          <input
            type="password"
            required
            placeholder="Mot de passe (8+ caractères)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414]/80 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all focus:border-[#00FF00]/60"
          />
          <input
            type="password"
            required
            placeholder="Confirmer le mot de passe"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
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
                Création...
              </>
            ) : (
              <>
                Créer mon compte
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          Déjà un compte ?{' '}
          <Link href="/auth/signin" className="font-bold text-[#00FF00] hover:underline">
            Se connecter
          </Link>
        </p>
      </motion.div>
    </div>
  );
}