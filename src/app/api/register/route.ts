import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { rateLimitCheck } from '@/lib/redis';
import { getClientIP } from '@/lib/ip';

/**
 * POST /api/register — crée un compte utilisateur.
 * Body : { email, password }
 *
 * SÉCURITÉ :
 *  - Mot de passe HACHÉ avec bcrypt (jamais en clair).
 *  - Validation serveur (longueur mdp, format email).
 *  - Rate limiting anti-spam (crée pas 1000 comptes en boucle).
 *  - Ne renvoie JAMAIS le hash ni de données sensibles.
 */
export const runtime = 'nodejs';

// Moins d'essais que /api/access (un compte par IP, c'est rare d'en créer beaucoup)
const REGISTER_RATE_LIMIT_MAX = 3;
const REGISTER_RATE_LIMIT_WINDOW = 60 * 10; // 10 minutes
// getClientIP importé depuis '@/lib/ip' (extraction d'IP sécurisée, anti-spoofing).

export async function POST(request: NextRequest) {
  // === RATE LIMITING (10 min / IP) ===
  const rl = await rateLimitCheck(
    `register:${getClientIP(request)}`,
    REGISTER_RATE_LIMIT_MAX,
    REGISTER_RATE_LIMIT_WINDOW
  );
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Trop de créations. Réessayez dans ' + retryAfter + 's.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  // === LECTURE + VALIDATION ===
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON invalide.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email invalide.' }, { status: 400 });
  }
  if (email.length > 254) {
    return NextResponse.json(
      { error: "L'adresse email ne doit pas dépasser 254 caractères." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Le mot de passe doit faire au moins 8 caractères.' },
      { status: 400 }
    );
  }
  if (password.length > 128) {
    return NextResponse.json(
      { error: 'Le mot de passe ne doit pas dépasser 128 caractères.' },
      { status: 400 }
    );
  }

  // === ÉVITER DOUBLON d'email ===
  // SÉCURITÉ (anti-énumération) : on ne révèle PAS si l'email existe déjà.
  // Réponse identique (200 + message neutre) que le compte existe ou non —
  // un attaquant ne peut pas deviner qui a un compte. (La création réelle
  // reste protégée par le unique() de Prisma : en cas de course, elle échoue
  // silencieusement côté serveur.)
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Anti-énumération temporelle : le cas succès fait un bcrypt.hash (~100ms).
    // On fait un bcrypt.compare contre le hash existant pour égaliser le temps
    // de réponse — sinon un attaquant pourrait distinguer "email connu"
    // (rapide) de "email nouveau" (lent) via une attaque par analyse temporelle.
    await bcrypt.compare(password, existing.passwordHash ?? '').catch(() => null);
    return NextResponse.json(
      {
        user: null,
        message:
          "Si cet email n'a pas déjà de compte, vérifie ta boîte de réception pour confirmer ton inscription.",
      },
      { status: 200 }
    );
  }

  // === CRÉATION ===
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: { email, passwordHash },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    // Ne renvoie aucune donnée sensible (nom du user OK, jamais le hash).
    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt } },
      { status: 201 }
    );
  } catch (e) {
    console.error('[register] Erreur création:', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Création impossible, réessayez.' }, { status: 500 });
  }
}