import type { NextRequest } from 'next/server';

/**
 * getClientIP — extraction de l'IP client SÉCURISÉE.
 *
 * ⚠️ Ne JAMAIS faire confiance au premier hop de X-Forwarded-For :
 *    c'est une en-tête contrôlée par le CLIENT (spoofing trivial).
 *
 * Ordre de priorité :
 *  1. `x-vercel-forwarded-for` — défini par Vercel (proxy de confiance, non spoofable)
 *  2. DERNIER hop de `x-forwarded-for` (ajouté par notre reverse-proxy : Caddy/Vercel)
 *  3. `x-real-ip` (fallback proxy)
 *  4. 'unknown'
 */
export function getClientIP(request: NextRequest): string {
  const vercelFF = request.headers.get('x-vercel-forwarded-for');
  if (vercelFF) {
    // Vercel met l'IP réelle du client ; on prend le dernier hop par prudence.
    const ip = vercelFF.split(',').pop()?.trim();
    if (ip) return ip;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Le DERNIER élément est ajouté par le proxy le plus proche (de confiance) ;
    // les premiers peuvent être forgés par le client.
    const ip = forwarded.split(',').pop()?.trim();
    if (ip) return ip;
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP.trim();

  return 'unknown';
}
