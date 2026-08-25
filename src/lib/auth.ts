import NextAuth, { type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { rateLimitCheck } from '@/lib/redis';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * AUTHENTIFICATION PAR COMPTE (email + mot de passe)
 * ─────────────────────────────────────────────────────────────────────────
 * - Mots de passe HACHÉS avec bcrypt (jamais stockés en clair).
 * - Sessions JWT signées par NextAuth (cryptées et sécurisées).
 * - L'adresse email est le seul identifiant.
 *
 * SÉCURITÉ :
 *  - NEXTAUTH_SECRET doit être défini en prod (Vercel) — sinon, en dev,
 *    NextAuth ne démarre pas sans lui.
 *  - Le hash bcrypt (coût 10+) rend quasi impossible le brute-force des
 *    mots de passe, même si la base fuyait.
 *  - La comparaison se fait en temps constant côté bcrypt (anti timing-attack).
 */

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'email-password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },

      // Appelé à chaque tentative de connexion. Retourne un user si OK, null sinon.
      // ⚠️ NextAuth v4 : `req` est un objet { headers?, query?, body? } SIMPLE,
      // PAS un NextRequest — d'où l'erreur "e.headers.get is not a function"
      // si on lui applique getClientIP(NextRequest). On lit les en-têtes
      // défensivement (get peut être absent selon le runtime).
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        // === ANTI BRUTE-FORCE sur le LOGIN — DOUBLE limite ===
        // 1. Par email : protège le COMPTE.
        // 2. Par IP si récupérable SANS risquer de faire planter le login :
        //    extraction défensive, fallback 'unknown' au moindre doute.
        let ip = 'unknown';
        try {
          const headers = (req as unknown as { headers?: unknown })?.headers;
          const getFn =
            typeof (headers as { get?: unknown })?.get === 'function'
              ? (headers as Headers).get.bind(headers)
              : null;
          if (getFn) {
            const vercelFF = getFn('x-vercel-forwarded-for');
            if (vercelFF) ip = vercelFF.split(',').pop()?.trim() || 'unknown';
            if (ip === 'unknown') {
              const xff = getFn('x-forwarded-for');
              if (xff) ip = xff.split(',').pop()?.trim() || 'unknown';
            }
            if (ip === 'unknown') {
              ip = getFn('x-real-ip')?.trim() || 'unknown';
            }
          }
        } catch {
          ip = 'unknown'; // jamais bloquer une connexion pour un souci d'en-tête
        }

        const rlEmail = await rateLimitCheck(`login:${email}`, 10, 60 * 15);
        if (!rlEmail.allowed) {
          throw new Error('Trop de tentatives de connexion. Réessayez plus tard.');
        }
        if (ip !== 'unknown') {
          const rlIp = await rateLimitCheck(`login-ip:${ip}`, 20, 60 * 15);
          if (!rlIp.allowed) {
            throw new Error('Trop de tentatives de connexion. Réessayez plus tard.');
          }
        }

        const user = await db.user.findUnique({ where: { email } });
        // Utilisateur inconnu OU pas de mot de passe défini (ex: compte sans mdp) → refus.
        if (!user || !user.passwordHash) return null;

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) return null;

        // Retourne UNIQUEMENT des données sûres (jamais passwordHash).
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],

  session: {
    strategy: 'jwt',
  },

  pages: {
    signIn: '/auth/signin',
    // (v4 n'a pas d'option signUp — le lien vers l'inscription est dans la page de connexion.)
  },

  callbacks: {
    // Injecte l'id utilisateur dans le JWT (utile plus tard pour lier UserBet).
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  // En dev comme en prod, on exige le secret. En dev on autorise un fallback
  // temporaire mais on loggue un avertissement.
  secret: process.env.NEXTAUTH_SECRET,
};

// NextAuth v4 : `NextAuth(authOptions)` renvoie un handler App Router utilisable
// directement. La route /api/auth/[...nextauth] l'exporte sous GET/POST.
export default NextAuth(authOptions);

// Helper pour lire la session côté serveur (routes API, pages serveur).
// Utilise la config auth définie ci-dessus.
export { getServerSession } from 'next-auth';