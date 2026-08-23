import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

/**
 * Protection d'API côté serveur.
 * À utiliser au début de chaque route API sensible.
 * Retourne { ok: true } → continue, sinon répond 401.
 */
export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Non autorisé. Connectez-vous.' },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, session };
}