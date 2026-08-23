'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Fournisseur de session NextAuth, isolé dans un composant client.
 * Le layout racine (Server Component) peut l'utiliser sans provoquer
 * "React Context is unavailable in Server Components" au rendu de pages serveur
 * (auth/register, auth/signin, _not-found...).
 */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}