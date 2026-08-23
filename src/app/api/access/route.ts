import { NextRequest, NextResponse } from 'next/server';
import { rateLimitCheck } from '@/lib/redis';

// Code d'accès stocké côté SERVEUR (env var). JAMAIS dans le bundle front.
// Fallback dev : '230409' (garder le comportement actuel tant que ACCESS_CODE n'est pas défini).
// En production, définir ACCESS_CODE sur la plateforme d'hébergement (Vercel) et le changer.
const ACCESS_CODE = process.env.ACCESS_CODE || '230409';

// Anti brute-force : 5 essais/min par IP (le code est court, donc réponses rapides → rate limit serré).
const ACCESS_RATE_LIMIT_MAX = 5;
const ACCESS_RATE_LIMIT_WINDOW = 60;

export const runtime = 'nodejs';

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;
  return 'unknown';
}

export async function POST(request: NextRequest) {
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

  if (typeof submitted === 'string' && submitted.trim() === ACCESS_CODE) {
    return NextResponse.json({ allowed: true });
  }

  return NextResponse.json(
    { allowed: false, error: 'Code incorrect.' },
    { status: 401 }
  );
}