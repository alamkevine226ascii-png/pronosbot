'use client';

import { motion } from 'framer-motion';
import { ShieldCheck, Phone, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * Legal + RGPD cards — shown in the Profil tab (before Maintenance).
 * Required for any app that touches sports betting topics in France.
 */
export function LegalRgpdCards() {
  return (
    <>
      {/* Subtle section divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

      {/* Mentions légales — OBLIGATOIRE pour app liée aux paris sportifs en France */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.27 }}
      >
        <Card className="glass-card rounded-xl p-5 !border-amber-500/20">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#00FF00]" />
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">Mentions légales</h3>
          </div>
          <div className="space-y-3 text-[11px] leading-relaxed text-zinc-400">
            <p>
              <strong className="text-amber-400">⚠️ À but informatif uniquement.</strong> PronoBot est un outil d&apos;analyse et de prédiction football basé sur des données publiques (ESPN, API-Football). Les pronostics affichés ne constituent pas une incitation à parier. Les jeux d&apos;argent sont <strong className="text-white">interdits aux mineurs</strong> (-18 ans). Jouez de manière responsable.
            </p>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 font-bold text-amber-400">
                <Phone className="h-4 w-4" />
                Joueurs Info Service
              </p>
              <p className="mt-1 text-[11px] text-zinc-300">
                <a href="tel:0974751313" className="font-mono text-amber-400 hover:underline">09 74 75 13 13</a>
                {' '}(appel non surtaxé) — {' '}
                <a href="https://www.joueurs-info-service.fr" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">joueurs-info-service.fr</a>
              </p>
              <p className="mt-1 text-[10px] text-zinc-500">Aide gratuite pour les joueurs et leur entourage — 7j/7 de 8h à 2h</p>
            </div>
            <p className="text-[10px] text-zinc-500">
              Conformément à la loi française, PronoBot ne propose pas de paris réels, ne collecte pas de fonds, et n&apos;est pas affilié à un opérateur agréé par l&apos;ANJ (Autorité Nationale des Jeux).
            </p>
          </div>
        </Card>
      </motion.div>

      {/* Subtle section divider */}
      <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

      {/* RGPD — Politique de confidentialité */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.29 }}
      >
        <Card className="glass-card rounded-xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#00FF00]" />
            <h3 className="text-sm font-bold uppercase tracking-wide text-white">Confidentialité (RGPD)</h3>
          </div>
          <div className="space-y-2 text-[11px] leading-relaxed text-zinc-400">
            <p><strong className="text-white">Données collectées :</strong> Aucune. PronoBot ne nécessite pas de compte utilisateur.</p>
            <p><strong className="text-white">Cookies :</strong> Uniquement techniques (cache, préférence de ligue, consentement). Aucun cookie publicitaire ou de tracking tiers.</p>
            <p><strong className="text-white">Données de matchs :</strong> ESPN + API-Football (sources publiques). Les noms d&apos;équipes sont envoyés à notre IA (Z.AI) uniquement quand vous cliquez sur « Rechercher les infos chaudes sur le Web ».</p>
            <p><strong className="text-white">Hébergement :</strong> Serveurs en Europe. Aucune donnée transférée hors UE.</p>
            <p><strong className="text-white">Vos droits :</strong> Conformément au RGPD, droit d&apos;accès, de rectification et de suppression. Aucune donnée personnelle stockée — l&apos;exercice de ces droits n&apos;est généralement pas nécessaire. {' '}
              <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="text-[#00FF00] hover:underline">cnil.fr</a>
            </p>
          </div>
        </Card>
      </motion.div>
    </>
  );
}
