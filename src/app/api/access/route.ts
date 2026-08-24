import { NextRequest, NextResponse } from 'next/server';
import { rateLimitCheck } from '@/lib/redis';

// Code d'accès stocké côté SERVEUR (env var). JAMAIS dans le bundle front.
// SÉCURITÉ : plus AUCUN code par défaut. Si ACCESS_CODE n'est pas défini,
// la route répond 503 (service indisponible) au lieu d'accepter un code connu.
// → Définir ACCESS_CODE sur Vercel (valeur forte, min 12 caractères aléatoires).
const ACCESS_CODE = process.env.ACCESS_CODE;

// Anti brute-force : 5 essais/min par IP (le code est court, donc réponses rapides → rate limit serré).
const ACCESS_RATE_LIMIT_MAX = 5;
const ACCESS_RATE_LIMIT_WINDOW = 60;

export const runtime = 'nodejs';

import { getClientIP } from '@/lib/ip';
import { createHash, timingSafeEqual } from 'node:crypto';

// Comparaison constant-time du code d'accès (anti timing-attack) :
// on hache les DEUX côtés en sha256 pour égaliser les longueurs, puis
// timingSafeEqual. Un simple `===` fuit la longueur/position du préfixe correct.
function safeCodeCompare(submitted: string, expected: string): boolean {
  const a = createHash('sha256').update(submitted).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // === GARDE-FOU : pas de ACCESS_CODE configuré → refus total (jamais de fallback) ===
  if (!ACCESS_CODE) {
    console.error('[access] ACCESS_CODE non défini — route désactivée.');
    return NextResponse.json(
      { allowed: false, error: "Service d'accès non configuré." },
      { status: 503 }
    );
  }

  // === RATE LIMITING (empêche le brute-force du code) ===
  const clientIP = getClientIP(request);
  const rl = await rateLimitCheck(`access:${clientIP}`, ACCESS_RATE_LIMIT_MAX, ACCESS_RATE_LIMIT_WINDOW);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { allowed: false, error: 'Trop de tentatives. Réessayez dans ' + retryAfter + 's.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  // === VALIDATION DU CODE ===
  let submitted: unknown;
  try {
    const body = await request.json();
    submitted = body?.code;
  } catch {
    submitted = undefined;
  }

  if (typeof submitted === 'string' && safeCodeCompare(submitted.trim(), ACCESS_CODE)) {
    return NextResponse.json({ allowed: true });
  }

  return NextResponse.json(
    { allowed: false, error: 'Code incorrect.' },
    { status: 401 }
  );
}