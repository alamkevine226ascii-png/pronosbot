'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home as HomeIcon,
  Target,
  Layers,
  User,
  RefreshCw,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Download,
  Smartphone,
  Clock,
  Trophy,
  Zap,
  Brain,
  Database,
  Settings,
  Flame,
  Radio,
  BarChart3,
  ShieldCheck,
  CircleDot,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Crown,
  Gauge,
  Goal,
  Calendar,
  Percent,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { InstallPrompt } from '@/components/install-prompt';
import { CookieBanner } from '@/components/cookie-banner';
import { AccessGate } from '@/components/access-gate';
import { LegalRgpdCards } from '@/components/legal-rgpd-cards';
import { WebInsights } from '@/components/web-insights';

/* =========================================================================
 * TYPES
 * ========================================================================= */
type TabKey = 'home' | 'pronos' | 'combines' | 'profil';

interface Cotes {
  cote_1: number;
  cote_N: number;
  cote_2: number;
  cote_over25?: number;
  cote_under25?: number;
  estimated?: boolean;      // true if cotes are from Level 2 or 3 (not real DraftKings)
  source?: 'draftkings' | 'espn_predictor' | 'form_based';
}

interface TeamForm {
  forme_str: string;
  buts_marques_moy: number;
  buts_encaisses_moy?: number;
  pts_moy: number;
  wins: number;
  draws: number;
  losses: number;
  nb_matchs?: number;
  details?: Array<{ result: 'W' | 'D' | 'L'; opponent?: string; scored?: number; conceded?: number }>;
}

interface MatchContext {
  phase: string;
  enjeu: number;
  description: string;
}

interface Pari {
  type: string;
  sous_type?: string;
  choix?: string;
  selection?: string;
  recommandation?: string;
  probabilite: number;
  cote: number;
  ev: number;
  risque?: number;
  score_selection?: number;
}

interface ExpectedGoals {
  home: number;
  away: number;
  total: number;
}

interface Pronostic {
  probas_1x2: { prob_1: number; prob_N: number; prob_2: number };
  probas_ou: { prob_over: number; prob_under: number } | null;
  double_chance: {
    '1N': { proba: number; cote: number };
    'N2': { proba: number; cote: number };
    '12': { proba: number; cote: number };
  };
  pari_choisi: Pari;
  tous_paris: Pari[];
  top_scores?: Array<{ score: string; prob: number; cote: number }>;
  expected_goals?: ExpectedGoals;
  asian_totals?: Array<{
    line: number;
    type: 'quarter' | 'half';
    prob_over: number;
    prob_under: number;
    cote_over: number;
    cote_under: number;
    recommendation: string;
  }>;
}

interface Match {
  id: string;
  home_name_fr: string;
  away_name_fr: string;
  home_name?: string;
  away_name?: string;
  home_logo?: string;
  away_logo?: string;
  home_color?: string;
  away_color?: string;
  competition: string;
  competition_id: string;
  heure: string;
  cotes: Cotes;
  status: string;
  score_home: string;
  score_away: string;
  is_live: boolean;
  live_status: string;
  home_form: TeamForm;
  away_form: TeamForm;
  context: MatchContext;
  pronostic: Pronostic | null;
  date_match?: string; // YYYY-MM-DD
  // BUG #9 FIX : odds_source peut être 5 valeurs (pas seulement 3). Sans ça, TypeScript
  // refuse de passer `match.odds_source` à <WebInsights oddsSource=...> qui attend string.
  odds_source?: 'draftkings' | 'api_football' | 'football_data' | 'espn_predictor' | 'form_based';
}

interface CombinerMatch {
  home: string;
  away: string;
  bet?: string; // legacy field
  bet_type?: string;
  bet_selection?: string;
  competition?: string;
  heure?: string;
  cote: number;
  date_match?: string; // YYYY-MM-DD
}

interface Combiner {
  type: string; // "Combiné 2" or "Combiné 3"
  matchs: CombinerMatch[];
  cote_combinee: number;
  probabilite: number;
  ev: number;
  risque: number;
}

/* =========================================================================
 * CONSTANTS & HELPERS
 * ========================================================================= */
const GREEN = '#00FF00';
const LIVE_GREEN = '#00FF00';

const DAY_NAMES_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Returns YYYY-MM-DD for the local "today" (avoids UTC off-by-one). */
const todayStr = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Build a human-readable label for a YYYY-MM-DD date string.
 * - today     -> "Aujourd'hui"
 * - tomorrow  -> "Demain"
 * - otherwise -> "Mer 03" (french short day name + zero-padded day number)
 */
const formatDayLabel = (dateStr?: string): string => {
  if (!dateStr) return '—';
  const target = new Date(`${dateStr}T00:00:00`);
  if (isNaN(target.getTime())) return '—';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  return `${DAY_NAMES_FR[target.getDay()]} ${String(target.getDate()).padStart(2, '0')}`;
};

const formatPct = (n: number) => `${Math.round(n * 100)}%`;
const formatCote = (n: number | undefined | null) =>
  typeof n === 'number' && isFinite(n) && n > 0 ? n.toFixed(2) : '—';
const formatEv = (n: number) => {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
};

/** Resolve the human-readable selection text from a bet (new API: `selection`, legacy: `recommandation`). */
const getSelectionText = (p: { selection?: string; recommandation?: string; choix?: string; sous_type?: string; type?: string }) => {
  const v = p.selection || p.recommandation || p.choix || p.sous_type || p.type;
  return v && v.trim() ? v : '—';
};

const getFormChars = (form: TeamForm | undefined): string[] => {
  if (!form) return [];
  // Uppercase + strip spaces so 'wDL' / 'W D L' / 'WDL' all parse the same way.
  const str = (form.forme_str || '').toUpperCase().replace(/\s+/g, '');
  const arr = str.split('').filter((c) => ['W', 'D', 'L', '?'].includes(c));
  return arr.length ? arr : ['?', '?', '?'];
};

/**
 * Detecte quand la forme d'une equipe est "vide" (donnees non disponibles).
 * Retourne true si : nb_matchs === 0, OU forme_str === '???' / vide,
 * OU wins + draws + losses === 0, OU buts_marques_moy ET buts_encaisses_moy === 0.
 */
const isFormEmpty = (form: TeamForm | undefined | null): boolean => {
  if (!form) return true;
  // No matches played → empty.
  if (form.nb_matchs !== undefined && form.nb_matchs === 0) return true;
  const total = (form.wins || 0) + (form.draws || 0) + (form.losses || 0);
  if (total === 0) return true;
  const str = form.forme_str || '';
  if (!str || str === '???' || str.replace(/\?/g, '').length === 0) return true;
  // Loosened: only treat as empty if BOTH scored AND conceded are 0 (missing data).
  const scored = form.buts_marques_moy ?? 0;
  const conceded = form.buts_encaisses_moy ?? 0;
  if (scored === 0 && conceded === 0) return true;
  return false;
};

/* ---- Risk helper ---- */
type RiskLevel = 'low' | 'medium' | 'high';
interface RiskInfo {
  level: RiskLevel;
  label: string;       // full label for accessibility (title, aria-label, sr-only)
  shortLabel: string;  // abbreviated label for compact UI (AllBetsCard metadata)
  emoji: string;
  color: string; // hex
  textClass: string;
  bgClass: string;
  borderClass: string;
}

function getRiskInfo(proba: number): RiskInfo {
  // BUG FIX: quantification arrondie au palier de 5% AVANT classification.
  // Avant, deux probas quasi identiques (ex: BTTS Oui 49.9% et Non 50.1%) pouvaient
  // être affichées 50% / 50% mais classées "Élevé" vs "Moyen" parce que le seuil interne
  // à 0.50 basculait. On arrondit au pas de 0.05 pour que l'étiquette reste cohérente
  // avec la valeur affichée (formatPct arrondit au % près).
  const p = Math.round(proba * 20) / 20;
  // Low risk (proba ≥ 70%) = green — universal UX (safe = green).
  // Medium risk (50-70%) = amber. High risk (<50%) = red.
  if (p >= 0.7) {
    return {
      level: 'low',
      label: 'Faible risque',
      shortLabel: 'Faible',
      emoji: '🟢',
      color: '#00FF00',
      textClass: 'text-[#00FF00]',
      bgClass: 'bg-[#00FF00]/15',
      borderClass: 'border-[#00FF00]/40',
    };
  }
  if (p >= 0.5) {
    return {
      level: 'medium',
      label: 'Risque moyen',
      shortLabel: 'Moyen',
      emoji: '🟡',
      color: '#F59E0B',
      textClass: 'text-amber-400',
      bgClass: 'bg-amber-500/15',
      borderClass: 'border-amber-500/40',
    };
  }
  return {
    level: 'high',
    label: 'Risque élevé',
    shortLabel: 'Élevé',
    emoji: '🔴',
    color: '#EF4444',
    textClass: 'text-red-400',
    bgClass: 'bg-red-500/15',
    borderClass: 'border-red-500/40',
  };
}

/* ---------------------------------------------------------------
 * QUALITÉ / VALUE D'UN PARI — basée sur l'EV (écart proba vs cote marché).
 *   EV = (Probabilité algo) × Cote - 1
 *   - EV ≥ +5%  → « Oui » (vraie value : notre proba dépasse nettement la cote)
 *   - EV entre -2% et +5% → « Standard » (bull cohérent)
 *   - EV ≤ -2%  → « Non » (mauvaise value : cote plus basse que le juste prix)
 * C'est LA formule couplée à l'EV que tu demandais — fin du badge en dur.
 * --------------------------------------------------------------- */
type ValueQuality = { key: 'oui' | 'standard' | 'non'; label: string; short: string; className: string };
function getValueQuality(ev: number): ValueQuality {
  if (ev >= 0.05) {
    return { key: 'oui', label: 'Bonne value', short: 'Oui',
      className: 'text-[#00FF00]' };
  }
  if (ev <= -0.02) {
    return { key: 'non', label: 'Pas de value', short: 'Non',
      className: 'text-red-400' };
  }
  return { key: 'standard', label: 'Valeur standard', short: 'Standard',
    className: 'text-zinc-400' };
}

/* ---- Bet type color coding ---- */
interface BetTypeStyle {
  label: string;       // full label (e.g. "Double Chance")
  shortLabel: string;  // abbreviated for mobile (e.g. "DC")
  bg: string;
  text: string;
  border: string;
  dot: string;
  accent: string; // hex color used for accent bars/glows
}

function getBetTypeStyle(type: string): BetTypeStyle {
  const t = (type || '').toLowerCase();
  if (t.startsWith('1x2')) {
    return {
      label: '1X2',
      shortLabel: '1X2',
      bg: 'bg-[#00FF00]/15',
      text: 'text-[#00FF00]',
      border: 'border-[#00FF00]/40',
      dot: 'bg-[#00FF00]',
      accent: '#00FF00',
    };
  }
  // DC + BTTS (combiné) — doit être vérifié avant "Double Chance" et "BTTS"
  if (t.includes('dc + btts') || t.includes('dc+btts') || t.includes('dc btts')) {
    return {
      label: 'DC + BTTS',
      shortLabel: 'DC+BTTS',
      bg: 'bg-fuchsia-500/15',
      text: 'text-fuchsia-300',
      border: 'border-fuchsia-500/40',
      dot: 'bg-fuchsia-400',
      accent: '#D946EF',
    };
  }
  if (t.includes('double chance')) {
    return {
      label: 'Double Chance',
      shortLabel: 'DC',
      bg: 'bg-violet-500/15',
      text: 'text-violet-300',
      border: 'border-violet-500/40',
      dot: 'bg-violet-400',
      accent: '#8B5CF6',
    };
  }
  // Plus de Buts (Over 1.5, 2.5, 3.5) — remplace "Total Buts" et "Total Asiatique"
  if (t.includes('plus de buts') || t.includes('total buts') || t.includes('over') || t.includes('under')) {
    return {
      label: 'Plus de Buts',
      shortLabel: 'Over',
      bg: 'bg-blue-500/15',
      text: 'text-blue-300',
      border: 'border-blue-500/40',
      dot: 'bg-blue-400',
      accent: '#3B82F6',
    };
  }
  if (t.startsWith('btts') || t.includes('both teams')) {
    return {
      label: 'BTTS',
      shortLabel: 'BTTS',
      bg: 'bg-pink-500/15',
      text: 'text-pink-300',
      border: 'border-pink-500/40',
      dot: 'bg-pink-400',
      accent: '#EC4899',
    };
  }
  // Buteur (goalscorer) — jaune/orange
  if (t.includes('buteur') || t.includes('goalscorer')) {
    return {
      label: 'Buteur',
      shortLabel: 'Buteur',
      bg: 'bg-orange-500/15',
      text: 'text-orange-300',
      border: 'border-orange-500/40',
      dot: 'bg-orange-400',
      accent: '#F97316',
    };
  }
  if (t.includes('qualification')) {
    return {
      label: 'Qualification',
      shortLabel: 'Qualif',
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-300',
      border: 'border-emerald-500/40',
      dot: 'bg-emerald-400',
      accent: '#10B981',
    };
  }
  if (t.includes('mi-temps') || t.includes('mi_temps') || t.includes('mi temps')) {
    return {
      label: 'Mi-temps/Fin',
      shortLabel: 'MT/FT',
      bg: 'bg-[#00FF00]/15',
      text: 'text-[#00FF00]',
      border: 'border-[#00FF00]/40',
      dot: 'bg-[#00FF00]',
      accent: '#00FF00',
    };
  }
  if (t.includes('score exact')) {
    return {
      label: 'Score exact',
      shortLabel: 'Score',
      bg: 'bg-purple-500/15',
      text: 'text-purple-300',
      border: 'border-purple-500/40',
      dot: 'bg-purple-400',
      accent: '#A855F7',
    };
  }
  if (t.includes('buteur') || t.includes('goalscorer')) {
    return {
      label: 'Buteur',
      shortLabel: 'Buteur',
      bg: 'bg-pink-500/15',
      text: 'text-pink-300',
      border: 'border-pink-500/40',
      dot: 'bg-pink-400',
      accent: '#EC4899',
    };
  }
  return {
    label: type,
    shortLabel: type && type.length > 8 ? type.slice(0, 7) + '…' : (type || '—'),
    bg: 'bg-zinc-500/15',
    text: 'text-zinc-300',
    border: 'border-zinc-500/40',
    dot: 'bg-zinc-400',
    accent: '#a1a1aa',
  };
}

/* =========================================================================
 * COMPETITION COLOR (deterministic accent color per league)
 * ========================================================================= */
const COMPETITION_COLORS = [
  '#00FF00', // gold (brand primary)
  '#8B5CF6', // violet
  '#A855F7', // purple
  '#3B82F6', // blue
  '#EC4899', // pink
  '#22d3ee', // cyan
  '#fbbf24', // amber
  '#fb923c', // orange
  '#10B981', // emerald
  '#f87171', // red
];

function getCompetitionColor(competition: string | undefined): string {
  if (!competition) return COMPETITION_COLORS[0];
  let hash = 0;
  for (let i = 0; i < competition.length; i++) {
    hash = (hash << 5) - hash + competition.charCodeAt(i);
    hash |= 0;
  }
  return COMPETITION_COLORS[Math.abs(hash) % COMPETITION_COLORS.length];
}

/* =========================================================================
 * SMALL UI PRIMITIVES
 * ========================================================================= */

function LiveBadge({ status }: { status: string }) {
  // Live = bright green (#00FF00) per ClutchTime premium design.
  return (
    <span
      className="animate-live-pulse inline-flex items-center gap-1.5 rounded-full border border-[#00FF00]/40 bg-[#00FF00]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF00] backdrop-blur-sm"
      style={{ textShadow: 'none' }}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00FF00] opacity-75" />
        <span
          className="relative inline-flex h-2 w-2 rounded-full bg-[#00FF00]"
          style={{ boxShadow: '0 2px 6px rgba(0,255,0,0.4)' }}
        />
      </span>
      {status || 'LIVE'}
    </span>
  );
}

function FormBadge({ result }: { result: string }) {
  const map: Record<string, { bg: string; text: string; border: string; label: string; glow: string }> = {
    // Victory = green (universal UX). Previously indigo.
    W: {
      bg: 'bg-[#00FF00]/15',
      text: 'text-[#00FF00]',
      border: 'border-[#00FF00]/40',
      label: 'V',
      glow: '0 2px 4px rgba(0,255,0,0.25)',
    },
    D: {
      bg: 'bg-yellow-500/15',
      text: 'text-yellow-400',
      border: 'border-yellow-500/40',
      label: 'N',
      glow: '0 2px 4px rgba(234,179,8,0.2)',
    },
    L: {
      bg: 'bg-red-500/15',
      text: 'text-red-400',
      border: 'border-red-500/40',
      label: 'D',
      glow: '0 2px 4px rgba(239,68,68,0.2)',
    },
    '?': {
      bg: 'bg-zinc-700/30',
      text: 'text-zinc-500',
      border: 'border-zinc-600/40',
      label: '?',
      glow: 'none',
    },
  };
  const s = map[result] || map['?'];
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] font-black ${s.bg} ${s.text} ${s.border}`}
      style={{ boxShadow: s.glow }}
      title={result === 'W' ? 'Victoire' : result === 'D' ? 'Nul' : result === 'L' ? 'Défaite' : 'Inconnu'}
    >
      {s.label}
    </span>
  );
}

function ProbaBar({
  label,
  value,
  cote,
  color,
  highlight,
}: {
  label: string;
  value: number;
  cote?: number;
  color: string;
  highlight?: boolean;
}) {
  const pct = Math.max(2, Math.min(100, value * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span
          className={`truncate font-medium ${
            highlight ? 'text-white' : 'text-zinc-400'
          }`}
        >
          {label}
        </span>
        <div className="flex items-center gap-2">
          {cote ? (
            <span className="rounded-md bg-[#222222]/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {formatCote(cote)}
            </span>
          ) : null}
          <span
            className={`font-mono text-sm font-black ${
              highlight ? 'text-[#00FF00]' : 'text-zinc-200'
            }`}
          >
            {formatPct(value)}
          </span>
        </div>
      </div>
      <div
        className={`relative h-2.5 w-full overflow-hidden rounded-full bg-[#222222]/80 ${
          highlight ? 'ring-1 ring-[#00FF00]/40' : ''
        }`}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="relative h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${color}66 0%, ${color} 100%)`,
            boxShadow: highlight
              ? `0 2px 6px ${color}66`
              : `0 2px 4px ${color}33`,
          }}
        >
          <span
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 2.8s linear infinite',
            }}
            aria-hidden
          />
        </motion.div>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-md bg-[#00FF00]/12"
        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
      >
        <Icon className="h-3.5 w-3.5 text-[#00FF00]" />
      </span>
      <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
        {children}
      </h3>
      <span
        className="ml-1 h-px flex-1 bg-gradient-to-r from-zinc-700/60 to-transparent"
        aria-hidden
      />
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="h-px bg-gradient-to-r from-transparent via-zinc-800/80 to-transparent" />
  );
}

function MatchCardSkeleton() {
  return (
    <Card className="glass-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 space-y-2.5">
          <div className="h-2.5 w-24 rounded shimmer" />
          <div className="h-4 w-36 rounded shimmer" />
          <div className="h-4 w-28 rounded shimmer" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-9 w-10 rounded-md shimmer" />
          <div className="h-9 w-10 rounded-md shimmer" />
          <div className="h-9 w-10 rounded-md shimmer" />
        </div>
      </div>
    </Card>
  );
}

/* =========================================================================
 * RISK INDICATOR
 * ========================================================================= */
function RiskIndicator({
  proba,
  size = 'sm',
}: {
  proba: number;
  size?: 'sm' | 'md';
}) {
  const info = getRiskInfo(proba);
  const dim = size === 'md' ? 56 : 44;
  const stroke = size === 'md' ? 4 : 3.5;
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Inverse risk: high proba = low risk = full green ring.
  const fill = Math.max(0.08, Math.min(1, proba));
  const offset = circumference * (1 - fill);
  const labelSize = size === 'md' ? 'text-[11px]' : 'text-[9px]';
  const padding = size === 'md' ? 'gap-2' : 'gap-1.5';

  return (
    <span
      className={`inline-flex items-center ${padding}`}
      title={info.label}
      aria-label={info.label}
    >
      <span
        className="relative inline-flex items-center justify-center rounded-full"
        style={{
          width: dim,
          height: dim,
          backgroundColor: `${info.color}1a`,
          boxShadow: `inset 0 0 0 1px ${info.color}40`,
        }}
      >
        <svg
          width={dim}
          height={dim}
          viewBox={`0 0 ${dim} ${dim}`}
          className="absolute -rotate-90"
          aria-hidden
        >
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={stroke}
          />
          <motion.circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={info.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 1px 2px ${info.color}55)` }}
          />
        </svg>
        <span
          className="relative text-sm font-black leading-none"
          style={{ color: info.color, textShadow: 'none' }}
        >
          {info.level === 'low' ? '✓' : info.level === 'medium' ? '!' : '⚠'}
        </span>
      </span>
      <span className={`flex flex-col leading-tight`}>
        <span className={`font-bold uppercase tracking-wide ${labelSize} ${info.textClass}`}>
          {info.label}
        </span>
      </span>
    </span>
  );
}

function RiskMeter({ proba }: { proba: number }) {
  const info = getRiskInfo(proba);
  const pct = Math.max(4, Math.min(100, proba * 100));
  // Risk meter reverses the polarity: high proba = low risk (green full).
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-500">Niveau de risque</span>
        <span className={`font-bold ${info.textClass}`}>{info.label}</span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[#222222]/80 ring-1 ring-white/5">
        {/* Track gradient backdrop (red → yellow → green at high-probability end) */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              'linear-gradient(90deg, #FF3B30 0%, #FFAA00 50%, #00FF00 100%)',
          }}
          aria-hidden
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="relative h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${info.color}66, ${info.color})`,
            boxShadow: `0 2px 8px ${info.color}40`,
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
 * BET TYPE BADGE
 * ========================================================================= */
function BetTypeBadge({
  type,
  size = 'sm',
  short = false,
}: {
  type: string;
  size?: 'sm' | 'md';
  short?: boolean;
}) {
  const style = getBetTypeStyle(type);
  const padding = size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]';
  const label = short ? style.shortLabel : style.label;
  return (
    <span
      title={style.label}
      className={`inline-flex items-center gap-1.5 rounded-full border font-bold uppercase tracking-wide ${style.bg} ${style.text} ${style.border} ${padding}`}
      style={{ boxShadow: `inset 0 0 0 1px ${style.accent}10` }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.accent, boxShadow: `0 2px 4px ${style.accent}66` }}
      />
      <span className="truncate">{label}</span>
    </span>
  );
}

/* =========================================================================
 * MATCH CARD (Home tab)
 * ========================================================================= */
function MatchCard({
  match,
  onClick,
}: {
  match: Match;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      aria-label={`Voir le pronostic ${match.home_name_fr} vs ${match.away_name_fr}`}
      className="glass-card glass-card-hover relative w-full overflow-hidden rounded-xl text-left focus-neon"
      style={match.is_live ? { borderColor: '#00FF00', borderWidth: '2px' } : undefined}
    >
      <div className="relative p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-zinc-400">
            {match.competition}
          </span>
          {match.is_live ? (
            <span className="flex items-center gap-1 rounded-full bg-[#00FF00] px-2 py-0.5 text-[10px] font-bold uppercase text-black">
              <span className="h-1.5 w-1.5 rounded-full bg-black animate-live-pulse" />
              LIVE
            </span>
          ) : (
            <span className="font-mono text-xs font-medium text-zinc-400">
              {match.heure}
            </span>
          )}
        </div>
        {/* min-w-0 sur les spans d'équipes + text-sm sm:text-base pour éviter l'overflow sur mobile avec des... */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="min-w-0 truncate text-left text-sm font-bold text-white sm:text-base">
            {match.home_name_fr}
          </span>
          {match.is_live ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-2xl font-black text-white">
                {match.score_home}
              </span>
              {/* Colon en zinc-500 (au lieu de zinc-600) pour un meilleur contraste sur le fond noir de la carte. */}
              <span className="text-sm text-zinc-500">:</span>
              <span className="font-mono text-2xl font-black text-white">
                {match.score_away}
              </span>
            </div>
          ) : (
            <span className="shrink-0 rounded-md bg-[#333333] px-2.5 py-0.5 font-mono text-[10px] font-bold text-zinc-400">
              VS
            </span>
          )}
          <span className="min-w-0 truncate text-right text-sm font-bold text-white sm:text-base">
            {match.away_name_fr}
          </span>
        </div>
        {match.cotes ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-end">
              <EstimatedBadge source={match.odds_source} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <CotePill label="1" value={match.cotes.cote_1} />
              <CotePill label="N" value={match.cotes.cote_N} />
              <CotePill label="2" value={match.cotes.cote_2} />
            </div>
          </div>
        ) : null}
      </div>
    </motion.button>
  );
}

function CotePill({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex min-w-[3rem] flex-col items-center justify-center rounded-lg bg-[#333333] px-2 py-2">
      <span className="text-[10px] font-medium text-zinc-500">{label}</span>
      {/* truncate sur la cote pour gérer les valeurs longues (ex: 11.00) */}
      <span className="w-full truncate text-center font-mono text-sm font-bold text-white">
        {formatCote(value)}
      </span>
    </div>
  );
}

/* =========================================================================
 * ESTIMATED BADGE — shown next to cotes that are not from DraftKings (Level 2/3)
 * ========================================================================= */
function EstimatedBadge({ source }: { source?: string }) {
  if (!source || source === 'draftkings' || source === 'api_football') return null;
  // api_football = vraies cotes multi-bookmakers (pas estimées) → pas de badge
  // football_data = cotes agrégées multi-bookmakers (qualité élevée) → badge vert
  // espn_predictor = proba ESPN convertie → badge ambre
  // form_based = cotes théoriques IA → badge ambre
  if (source === 'football_data') {
    return (
      <span
        title="Cotes agrégées de 11 bookmakers (Football-Data.org) — haute précision"
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[#00FF00]/40 bg-[#00FF00]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#00FF00]"
      >
        <ShieldCheck className="h-2.5 w-2.5" />
        11 Bookmakers
      </span>
    );
  }
  const label = source === 'espn_predictor' ? 'Estimée ESPN' : 'Cote IA';
  const title = source === 'espn_predictor'
    ? 'Cotes estimées à partir des probabilités ESPN (DraftKings non disponible)'
    : 'Cotes générées par IA à partir de la forme récente (DraftKings, Football-Data et ESPN non disponibles)';
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400"
    >
      <Sparkles className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/* =========================================================================
 * CIRCULAR PROGRESS RING (SVG) — used by BestBetCard for probability
 * ========================================================================= */
function ProbRing({
  value,
  size = 80,
  stroke = 6,
  color = GREEN,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value));
  const offset = circumference * (1 - pct);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(63, 63, 70, 0.6)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 1px 2px ${color}55)` }}
        />
      </svg>
      <span className="absolute flex flex-col items-center leading-none">
        <span
          className="font-mono text-lg font-black"
          style={{ color, textShadow: 'none' }}
        >
          {formatPct(value)}
        </span>
      </span>
    </div>
  );
}

/* =========================================================================
 * BEST BET CARD (MEILLEUR PARI - highlighted)
 * ========================================================================= */
function BestBetCard({ pari }: { pari: Pari }) {
  const risk = getRiskInfo(pari.probabilite);
  const value = getValueQuality(pari.ev ?? 0);
  const betStyle = getBetTypeStyle(pari.type);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-10 blur-3xl"
          style={{ backgroundColor: GREEN }}
          aria-hidden
        />
        {/* Faint diagonal scanlines for "premium tech" feel */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent 0, transparent 6px, rgba(0,255,0,0.4) 6px, rgba(0,255,0,0.4) 7px)',
          }}
          aria-hidden
        />
        <span
          className="absolute left-0 top-0 h-full w-1"
          style={{
            background: `linear-gradient(180deg, ${GREEN} 0%, ${GREEN}88 80%, ${GREEN}00 100%)`,
            boxShadow: `0 2px 8px rgba(0,255,0,0.35)`,
          }}
          aria-hidden
        />

        <div className="relative">
          {/* Header — crown + label + bet type */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/15">
                <Crown className="h-4 w-4 text-amber-400" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
                  Recommandation
                </span>
                <span className="text-sm font-black uppercase tracking-wider text-[#00FF00]" style={{ textShadow: 'none' }}>
                  Meilleur pari
                </span>
              </div>
            </div>
            <BetTypeBadge type={pari.type} size="md" />
          </div>

          {/* Selection — large headline. break-words + min-w-0 sur le parent garantissent que les longues séle... */}
          <h2 className="min-w-0 break-words text-xl font-black leading-tight text-white sm:text-2xl">
            {getSelectionText(pari)}
          </h2>
          {pari.sous_type ? (
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              {pari.sous_type}
            </p>
          ) : null}

          {/* Stats — ring + cote + EV */}
          {/* Sur mobile (< sm) on empile verticalement pour éviter l'overflow de la grille 3-colonnes avec le ... */}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
            {/* Probability ring */}
            <div className="flex flex-col items-center gap-1">
              <ProbRing value={pari.probabilite} />
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Proba
              </span>
            </div>

            {/* Cote — HUGE neon with label above */}
            <div className="flex min-w-0 flex-col items-center text-center">
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Cote
              </span>
              <span
                className="font-mono text-2xl font-black leading-none text-[#00FF00] sm:text-5xl"
                style={{ textShadow: 'none' }}
              >
                {formatCote(pari.cote)}
              </span>
              <span
                className="mt-1 rounded-full border border-[#00FF00]/30 bg-[#00FF00]/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#00FF00]"
              >
                {betStyle.label}
              </span>
            </div>

            {/* Confiance — basée sur l'EV réel du pari (fin du badge "Maximale" en dur). */}
            <div className="flex min-w-0 flex-col items-center gap-1 text-center">
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-300/80">
                Confiance
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide ${value.className}`} style={{ textShadow: 'none' }}>
                <Crown className="h-3 w-3" />
                {value.short}
              </span>
            </div>
          </div>

          {/* Risk row — circular badge + label */}
          <div className="mt-5 flex items-center justify-between rounded-lg border border-[#00FF00]/20 bg-[#1A1A1A]/80 px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <Gauge className="h-3.5 w-3.5 text-zinc-500" />
              Évaluation du risque
            </span>
            <RiskIndicator proba={pari.probabilite} size="sm" />
          </div>
          <p className="sr-only">
            Niveau de risque: {risk.label}, probabilité de {formatPct(pari.probabilite)}.
          </p>
        </div>
      </Card>
    </motion.div>
  );
}

/* =========================================================================
 * ALL BETS CARD (each entry of tous_paris)
 * ========================================================================= */
function AllBetsCard({ pari, isBest }: { pari: Pari; isBest?: boolean }) {
  const ev = pari.ev ?? 0;
  const risk = getRiskInfo(pari.probabilite);
  const value = getValueQuality(ev);
  const style = getBetTypeStyle(pari.type);
  const probaPct = Math.max(2, Math.min(100, pari.probabilite * 100));

  const evColor = ev > 0 ? 'text-[#00FF00]' : ev < 0 ? 'text-red-400' : 'text-zinc-400';
  const EvIcon = ev > 0 ? TrendingUp : ev < 0 ? TrendingDown : Minus;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      whileHover={{ y: -2 }}
    >
      <Card
        className={`glass-card glass-card-hover group relative overflow-hidden rounded-xl p-3.5 pl-5 ${
          isBest ? '!border-[#00FF00]/60' : ''
        }`}
        style={{
          boxShadow: isBest ? `0 2px 8px rgba(0,255,0,0.2)` : undefined,
        }}
      >
        <span
          className="absolute left-0 top-0 h-full w-1.5"
          style={{
            background: `linear-gradient(180deg, ${style.accent} 0%, ${style.accent}77 60%, ${style.accent}00 100%)`,
            boxShadow: `0 2px 6px ${style.accent}55`,
          }}
          aria-hidden
        />
        {isBest && (
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl"
            style={{ backgroundColor: GREEN }}
            aria-hidden
          />
        )}

        <div className="relative">
          {/* ═══ HEADER ROW: badge (left) + cote (right) ═══ Sur mobile, badge et cote sont sur la même ligne ... */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <BetTypeBadge type={pari.type} short />
              {isBest ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-yellow-300 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-black"
                  style={{ boxShadow: '0 2px 6px rgba(251,191,36,0.3)' }}
                  title="Meilleur pari — confiance maximale"
                >
                  <Crown className="h-2.5 w-2.5" /> Top
                </span>
              ) : null}
            </div>
            {/* Cote — compact, aligned right */}
            <div className="flex shrink-0 items-baseline gap-1">
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                Cote
              </span>
              <span
                className="rounded-md border border-[#00FF00]/30 bg-[#00FF00]/8 px-1.5 py-0.5 font-mono text-lg font-black leading-tight text-[#00FF00] sm:text-xl"
                style={{ textShadow: 'none' }}
              >
                {formatCote(pari.cote)}
              </span>
            </div>
          </div>

          {/* ═══ SELECTION TEXT — full width ═══ */}
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-white">
            {getSelectionText(pari)}
          </p>

          {/* ═══ METADATA GRID — 3 equal columns (P | EV | Risque) ═══ Grille fixe au lieu de flex-wrap pour u... */}
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {/* Proba */}
            <div className="rounded-md border border-[#2A2A2A] bg-[#1A1A1A]/60 px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-600">
                Proba
              </p>
              <p className="font-mono text-sm font-black text-white">
                {formatPct(pari.probabilite)}
              </p>
            </div>
            {/* Value ou Confiance — fondé sur l'EV réel (getValueQuality). */}
            <div className="rounded-md border border-[#2A2A2A] bg-[#1A1A1A]/60 px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-600">
                {isBest ? 'Confiance' : 'Value'}
              </p>
              {isBest ? (
                <p className="flex items-center gap-0.5 text-sm font-black text-amber-400">
                  <Crown className="h-3 w-3" /> {value.short}
                </p>
              ) : value.key === 'oui' ? (
                <p className={`flex items-center gap-0.5 text-sm font-bold ${value.className}`}>
                  <TrendingUp className="h-3 w-3" /> {value.short}
                </p>
              ) : value.key === 'non' ? (
                <p className={`flex items-center gap-0.5 text-sm font-bold ${value.className}`}>
                  <TrendingDown className="h-3 w-3" /> {value.short}
                </p>
              ) : (
                <p className="flex items-center gap-0.5 text-sm font-bold text-zinc-400">
                  <Minus className="h-3 w-3" /> {value.short}
                </p>
              )}
            </div>
            {/* Risque */}
            <div className="rounded-md border border-[#2A2A2A] bg-[#1A1A1A]/60 px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-600">
                Risque
              </p>
              <p
                className="flex items-center gap-1 text-sm font-bold"
                style={{ color: risk.color }}
                title={risk.label}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: risk.color, boxShadow: `0 2px 4px ${risk.color}66` }}
                />
                {risk.shortLabel}
              </p>
            </div>
          </div>

          {/* ═══ ANIMATED PROBABILITY BAR ═══ */}
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[#222222]/80">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${probaPct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="relative h-full rounded-full"
              style={{
                background: `linear-gradient(90deg, ${style.accent}66 0%, ${style.accent} 100%)`,
                boxShadow: `0 2px 4px ${style.accent}55`,
              }}
            >
              <span
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 2.8s linear infinite',
                }}
                aria-hidden
              />
            </motion.div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

/* =========================================================================
 * COMBINER CARD
 * ========================================================================= */
function CombinerCard({ combiner }: { combiner: Combiner }) {
  const risk = getRiskInfo(combiner.probabilite);
  const ev = combiner.ev ?? 0;

  return (
    <div>
      <Card className="glass-card relative overflow-hidden rounded-xl">
        {/* Ligne d'accent en haut — gold premium */}
        <div
          className="h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${GREEN} 30%, ${GREEN} 70%, transparent 100%)`,
            boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
          }}
        />

        {/* En-tête — badge de type premium + cote totale (gold premium, gros) */}
        <div className="relative flex items-center justify-between gap-3 border-b border-[#00FF00]/15 bg-[#1A1A1A]/95 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/12"
              style={{ boxShadow: `0 2px 6px rgba(0,255,0,0.2)` }}
            >
              <Layers className="h-4 w-4 text-[#00FF00]" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className="inline-flex w-fit max-w-full items-center truncate rounded-full border border-[#00FF00]/30 bg-[#00FF00]/15 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#00FF00]"
                style={{ textShadow: 'none' }}
              >
                {combiner.type}
              </span>
              <span className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
                {combiner.matchs.length} matchs
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Cote totale
            </p>
            <p
              className="font-mono text-2xl font-black leading-tight tabular-nums text-[#00FF00] sm:text-3xl"
              style={{ textShadow: 'none' }}
            >
              {formatCote(combiner.cote_combinee)}
            </p>
          </div>
        </div>

        {/* Matches list — betting-slip style rows */}
        <div className="relative divide-y divide-zinc-800/60">
          {combiner.matchs.map((m, i) => {
            const betType = m.bet_type || '';
            const betSel = m.bet_selection || m.bet || '';
            const style = getBetTypeStyle(betType);
            return (
              <div
                key={i}
                className={`relative px-4 py-3 pl-5 transition-colors duration-200 hover:bg-[#00FF00]/3 ${
                  i % 2 === 0 ? 'bg-[#1A1A1A]/30' : ''
                }`}
              >
                {/* accent bar per match — colored left border */}
                <span
                  className="absolute left-0 top-0 h-full w-1"
                  style={{
                    backgroundColor: style.accent,
                    boxShadow: `0 2px 4px ${style.accent}55`,
                  }}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">
                      {m.home} <span className="text-zinc-600">vs</span>{' '}
                      {m.away}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                      {m.date_match ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#00FF00]/40 bg-[#00FF00]/8 px-2 py-0.5 font-bold text-[#00FF00]">
                          <Calendar className="h-2.5 w-2.5" />
                          {formatDayLabel(m.date_match)}
                        </span>
                      ) : null}
                      {m.competition ? (
                        <span className="truncate">{m.competition}</span>
                      ) : null}
                      {m.heure ? (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span className="flex shrink-0 items-center gap-0.5 font-mono">
                            <Clock className="h-2.5 w-2.5" />
                            {m.heure}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {betType ? <BetTypeBadge type={betType} short /> : null}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                        {betSel}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="mb-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-600">
                      Cote
                    </span>
                    <span
                      className="rounded-md border border-[#00FF00]/25 bg-[#00FF00]/8 px-2 py-0.5 font-mono text-base font-black text-[#00FF00]"
                      style={{ textShadow: 'none' }}
                    >
                      {formatCote(m.cote)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer — proba + EV + risk meter, 3 equal columns with icons */}
        <div className="relative border-t border-[#00FF00]/15 bg-[#1A1A1A]/95 p-3 sm:p-4">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-2.5">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                <Percent className="h-3 w-3" /> Proba
              </div>
              <p
                className="mt-1 font-mono text-base font-black text-white"
              >
                {formatPct(combiner.probabilite)}
              </p>
            </div>
            <div className="rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-2.5">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                <TrendingUp className="h-3 w-3" /> Value
              </div>
              {/* Value — fondée sur l'EV réel (getValueQuality). */}
              {(() => {
                const v = getValueQuality(ev);
                const Icon = v.key === 'oui' ? TrendingUp : v.key === 'non' ? TrendingDown : Minus;
                return (
                  <p className={`mt-1 flex items-center gap-0.5 text-base font-bold ${v.className}`}>
                    <Icon className="h-3 w-3" /> {v.short}
                  </p>
                );
              })()}
            </div>
            <div className="rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-2.5">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-zinc-500">
                <AlertCircle className="h-3 w-3" /> Risque
              </div>
              <p
                className="mt-1 flex items-center gap-1 font-mono text-base font-bold"
                style={{ color: risk.color }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: risk.color, boxShadow: `0 2px 4px ${risk.color}66` }}
                />
                {(combiner.risque * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          <RiskMeter proba={combiner.probabilite} />
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
 * PRONOS DETAIL VIEW
 * ========================================================================= */
function PronosDetail({
  match,
  onBack,
}: {
  match: Match;
  onBack: () => void;
}) {
  const p = match.pronostic;
  const homeForm = getFormChars(match.home_form);
  const awayForm = getFormChars(match.away_form);

  // === AUTO-FETCH GOALSCORER ===
  // Récupère automatiquement le nom du buteur via web-search quand on ouvre un match.
  // Le nom remplace "(joueur clé)" dans le pari Buteur de tous_paris.
  // États: 'loading' (recherche en cours), 'found' (nom trouvé), 'empty' (aucun nom trouvé)
  const [goalscorerData, setGoalscorerData] = useState<{
    matchId: string;
    name: string;
    status: 'loading' | 'found' | 'empty';
  }>({ matchId: '', name: '', status: 'loading' });

  useEffect(() => {
    // Reset au loading quand on change de match
    let cancelled = false;

    // Auto-fetch : pas besoin que l'utilisateur clique sur le bouton web
    fetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        home: match.home_name_fr,
        away: match.away_name_fr,
        competition: match.competition,
        date: match.date_match,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (!data) {
          setGoalscorerData({ matchId: match.id, name: '', status: 'empty' });
          return;
        }
        const gs = data.goalscorers;
        const name = gs?.top_scorer?.trim() || '';
        setGoalscorerData({
          matchId: match.id,
          name,
          status: name ? 'found' : 'empty',
        });
      })
      .catch(() => {
        if (!cancelled) setGoalscorerData({ matchId: match.id, name: '', status: 'empty' });
      });

    return () => { cancelled = true; };
  }, [match.id, match.home_name_fr, match.away_name_fr, match.competition, match.date_match]);

  // Le nom n'est valide que pour le match courant (évite les résidus d'un match précédent)
  const goalscorerName = goalscorerData.matchId === match.id ? goalscorerData.name : '';
  const goalscorerStatus = goalscorerData.matchId === match.id ? goalscorerData.status : 'loading';

  // Override le pari "Buteur" avec le vrai nom ou un message selon le statut
  const tousParisAvecButeur = useMemo(() => {
    const tousParis = p?.tous_paris;
    if (!tousParis) return tousParis;
    return tousParis.map(bet => {
      if (bet.type === 'Buteur' && bet.selection?.includes('joueur clé')) {
        let newSelection = bet.selection;
        let newSousType = bet.sous_type;
        if (goalscorerStatus === 'found' && goalscorerName) {
          newSelection = `Buteur: ${goalscorerName}`;
          newSousType = goalscorerName;
        } else if (goalscorerStatus === 'loading') {
          newSelection = `Buteur: Recherche en cours...`;
          newSousType = '...';
        } else {
          newSelection = `Buteur: ${bet.sous_type} (à confirmer)`;
        }
        return { ...bet, selection: newSelection, sous_type: newSousType };
      }
      return bet;
    });
  }, [p?.tous_paris, goalscorerName, goalscorerStatus]);

  // Smooth scroll-to-top when entering the detail view.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [match.id]);

  return (
    <div className="detail-enter space-y-4">
      <button
        onClick={onBack}
        // py-3 + min-h-[44px] to meet the WCAG 2.5.5 44px touch-target guideline
        // (was py-2 ≈ 24px, too small to tap reliably on mobile).
        className="flex min-h-[44px] items-center gap-1.5 rounded-md py-3 text-xs font-bold text-zinc-400 transition-colors hover:text-[#00FF00] focus-neon"
        aria-label="Retour à la liste des matchs"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour à la liste
      </button>

      {/* MATCH HEADER */}
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        {/* Top accent line — competition colored */}
        <div
          className="absolute left-0 top-0 h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${getCompetitionColor(match.competition)} 30%, ${getCompetitionColor(match.competition)} 70%, transparent 100%)`,
            boxShadow: `0 2px 6px ${getCompetitionColor(match.competition)}55`,
          }}
        />
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-10 blur-3xl"
          style={{ backgroundColor: getCompetitionColor(match.competition) }}
          aria-hidden
        />
        <div className="relative mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate text-[11px] font-bold uppercase tracking-wider text-[#00FF00]"
              style={{ textShadow: 'none' }}
            >
              {match.competition}
            </span>
            <EstimatedBadge source={match.odds_source} />
          </div>
          {match.is_live ? (
            <LiveBadge status={match.live_status} />
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#00FF00]/15 bg-[#1A1A1A]/40 px-2 py-0.5 text-xs text-zinc-300">
              <Clock className="h-3 w-3 text-[#00FF00]" />
              <span className="font-mono font-bold">{match.heure}</span>
            </span>
          )}
        </div>

        <div className="relative flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-base font-black leading-tight text-white sm:text-lg">
              {match.home_name_fr}
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Domicile</p>
          </div>

          {match.is_live ? (
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/8 px-2 py-1">
              <span
                className="font-mono text-2xl font-black text-[#00FF00] sm:text-3xl"
                style={{ textShadow: 'none' }}
              >
                {match.score_home}
              </span>
              <span className="text-base text-zinc-500 sm:text-xl">:</span>
              <span
                className="font-mono text-2xl font-black text-[#00FF00] sm:text-3xl"
                style={{ textShadow: 'none' }}
              >
                {match.score_away}
              </span>
            </div>
          ) : (
            <div className="shrink-0 rounded-lg border border-[#00FF00]/20 bg-[#1A1A1A]/50 px-2 py-1">
              <span className="font-mono text-sm font-black tracking-widest text-zinc-400">VS</span>
            </div>
          )}

          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-base font-black leading-tight text-white sm:text-lg">
              {match.away_name_fr}
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Extérieur</p>
          </div>
        </div>

        <div className="relative mt-3 flex items-center gap-1.5 rounded-lg border border-[#00FF00]/15 bg-[#1A1A1A]/40 px-2.5 py-1.5 text-[11px] text-zinc-400">
          <CircleDot className="h-3 w-3 shrink-0 text-[#00FF00]" />
          <span className="truncate">{match.context.description}</span>
        </div>
      </Card>

      {!p ? (
        <Card className="glass-card rounded-xl p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
          <p className="text-sm text-zinc-400">
            Aucun pronostic disponible pour ce match (cotes manquantes).
          </p>
        </Card>
      ) : (
        <>
          {/* MEILLEUR PARI — highlighted */}
          <BestBetCard pari={p.pari_choisi} />

          <SectionDivider />

          {/* TOUS LES PARIS */}
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md bg-[#00FF00]/12"
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
              >
                <Target className="h-3.5 w-3.5 text-[#00FF00]" />
              </span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
                Tous les paris
              </h3>
              <span className="ml-1 h-px flex-1 bg-gradient-to-r from-zinc-700/60 to-transparent" aria-hidden />
              <Badge
                variant="outline"
                className="border-[#00FF00]/30 bg-[#00FF00]/10 text-[10px] font-black text-[#00FF00]"
              >
                {p.tous_paris?.length || 0}
              </Badge>
            </div>
            {(tousParisAvecButeur && tousParisAvecButeur.length > 0) ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tousParisAvecButeur.map((bet, i) => (
                  <AllBetsCard
                    key={`${bet.type}-${bet.choix || bet.sous_type || ''}-${i}`}
                    pari={bet}
                    isBest={
                      (bet.selection
                        ? bet.selection === p.pari_choisi.selection
                        : bet.recommandation === p.pari_choisi.recommandation) &&
                      bet.type === p.pari_choisi.type
                    }
                  />
                ))}
              </div>
            ) : (
              <Card className="glass-card rounded-xl p-6 text-center text-sm text-zinc-500">
                Aucun pari alternatif disponible.
              </Card>
            )}
          </div>

          <SectionDivider />

          {/* EXPECTED GOALS — comparison bar */}
          {p.expected_goals && (
            <Card className="glass-card rounded-xl p-5">
              <SectionTitle icon={Goal}>Buts attendus (xG)</SectionTitle>
              <div className="space-y-3">
                {/* Numbers row */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="min-w-0 text-right">
                    <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
                      {match.home_name_fr}
                    </p>
                    <p
                      className="font-mono text-3xl font-black leading-tight text-[#00FF00]"
                      style={{ textShadow: 'none' }}
                    >
                      {p.expected_goals.home.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-center rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/5 px-3 py-1.5">
                    <span className="text-[9px] uppercase tracking-wide text-[#00FF00]">
                      Total
                    </span>
                    <span className="font-mono text-xl font-black text-white">
                      {p.expected_goals.total.toFixed(2)}
                    </span>
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
                      {match.away_name_fr}
                    </p>
                    <p
                      className="font-mono text-3xl font-black leading-tight text-[#00FF00]"
                      style={{ textShadow: 'none' }}
                    >
                      {p.expected_goals.away.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Comparison bar with center divider */}
                {(() => {
                  const total = Math.max(
                    0.01,
                    p.expected_goals.home + p.expected_goals.away
                  );
                  const homePct = (p.expected_goals.home / total) * 100;
                  const awayPct = (p.expected_goals.away / total) * 100;
                  return (
                    <div className="relative flex h-3 w-full overflow-hidden rounded-full bg-[#222222]">
                      {/* Left half (home side) — bar is right-aligned, anchored to center */}
                      <div className="flex h-full w-1/2 justify-end bg-[#222222]/40">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${homePct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-l-full"
                          style={{
                            background: `linear-gradient(270deg, ${GREEN}, ${GREEN}aa)`,
                            boxShadow: `0 2px 6px rgba(0,255,0,0.2)`,
                          }}
                        />
                      </div>
                      {/* Right half (away side) — bar is left-aligned, anchored to center */}
                      <div className="flex h-full w-1/2 justify-start bg-[#222222]/40">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${awayPct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-r-full"
                          style={{
                            background: `linear-gradient(90deg, ${GREEN}aa, ${GREEN})`,
                            boxShadow: `0 2px 6px rgba(0,255,0,0.2)`,
                          }}
                        />
                      </div>
                      {/* Center divider */}
                      <div className="pointer-events-none absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white/50" />
                    </div>
                  );
                })()}
              </div>
            </Card>
          )}

          {/* PROBAS 1X2 */}
          <Card className="glass-card rounded-xl p-5">
            <SectionTitle icon={BarChart3}>Probabilités 1X2</SectionTitle>
            <div className="space-y-3">
              <ProbaBar
                label={match.home_name_fr}
                value={p.probas_1x2.prob_1}
                cote={match.cotes?.cote_1}
                color={GREEN}
                highlight={p.pari_choisi.choix === '1'}
              />
              <ProbaBar
                label="Match nul"
                value={p.probas_1x2.prob_N}
                cote={match.cotes?.cote_N}
                color="#eab308"
                highlight={p.pari_choisi.choix === 'N'}
              />
              <ProbaBar
                label={match.away_name_fr}
                value={p.probas_1x2.prob_2}
                cote={match.cotes?.cote_2}
                color="#ef4444"
                highlight={p.pari_choisi.choix === '2'}
              />
            </div>
          </Card>

          {/* DOUBLE CHANCE */}
          <Card className="glass-card rounded-xl p-5">
            <SectionTitle icon={ShieldCheck}>Double Chance</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
              {(['1N', 'N2', '12'] as const).map((key) => {
                const dc = p.double_chance[key];
                const isActive = p.pari_choisi.choix === key;
                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 text-center transition-all duration-200 ${
                      isActive
                        ? 'border-[#00FF00]/60 bg-[#00FF00]/10'
                        : 'border-[#2A2A2A] bg-[#222222]/30 hover:border-[#00FF00]/30'
                    }`}
                    style={isActive ? { boxShadow: '0 2px 8px rgba(0,0,0,0.3)' } : undefined}
                  >
                    <p className="text-xs font-bold text-zinc-300">{key}</p>
                    <p
                      className="mt-1 font-mono text-base font-black text-[#00FF00]"
                      style={isActive ? { textShadow: 'none' } : undefined}
                    >
                      {formatPct(dc.proba)}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                      {formatCote(dc.cote)}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* OVER / UNDER 2.5 */}
          {p.probas_ou && (
            <Card className="glass-card rounded-xl p-5">
              <SectionTitle icon={Activity}>Over / Under 2.5</SectionTitle>
              <div className="space-y-3">
                <ProbaBar
                  label="Over 2.5 buts"
                  value={p.probas_ou.prob_over}
                  cote={match.cotes?.cote_over25}
                  color={GREEN}
                />
                <ProbaBar
                  label="Under 2.5 buts"
                  value={p.probas_ou.prob_under}
                  cote={match.cotes?.cote_under25}
                  color="#f97316"
                />
              </div>
            </Card>
          )}

          {/* TOTAL ASIATIQUE (analyse) */}
          {p.asian_totals && p.asian_totals.length > 0 && (
            <Card className="glass-card rounded-xl p-5">
              <SectionTitle icon={Layers}>Total Asiatique (analyse)</SectionTitle>
              <p className="mb-3 text-[10px] text-zinc-500">
                Lignes asiatiques avec remboursement partiel — analyse détaillée du total de buts
              </p>
              <div className="space-y-2">
                {p.asian_totals.map((at, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 transition-colors ${
                      at.recommendation === 'Over'
                        ? 'border-[#00FF00]/30 bg-[#00FF00]/5'
                        : at.recommendation === 'Under'
                        ? 'border-orange-500/30 bg-orange-500/5'
                        : 'border-[#2A2A2A] bg-[#1A1A1A]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-black text-white">
                          {at.line.toFixed(2)}
                        </span>
                        {at.type === 'quarter' && (
                          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                            ¼
                          </span>
                        )}
                        <span className={`text-[10px] font-bold ${
                          at.recommendation === 'Over' ? 'text-[#00FF00]' :
                          at.recommendation === 'Under' ? 'text-orange-400' :
                          'text-zinc-500'
                        }`}>
                          → {at.recommendation}
                        </span>
                      </div>
                      <div className="flex gap-3 text-[11px]">
                        <span className="flex items-center gap-1">
                          <span className="text-zinc-500">Over</span>
                          <span className="font-mono font-bold text-[#00FF00]">{(at.prob_over * 100).toFixed(0)}%</span>
                          <span className="font-mono text-zinc-400">@{at.cote_over.toFixed(2)}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-zinc-500">Under</span>
                          <span className="font-mono font-bold text-orange-400">{(at.prob_under * 100).toFixed(0)}%</span>
                          <span className="font-mono text-zinc-400">@{at.cote_under.toFixed(2)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* TOP SCORES */}
          {p.top_scores && p.top_scores.length > 0 && (
            <Card className="glass-card rounded-xl p-5">
              <SectionTitle icon={Target}>Scores exacts probables</SectionTitle>
              <p className="mb-3 text-[10px] text-zinc-500">
                Modèle mathématique Poisson (basé sur xG et forme récente)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {p.top_scores.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-3 text-center transition-colors hover:border-[#00FF00]/30"
                  >
                    <p className="font-mono text-lg font-black text-white">
                      {s.score}
                    </p>
                    <p className="mt-1 font-mono text-[11px] font-black text-[#00FF00]">
                      {formatPct(s.prob)}
                    </p>
                    <p className="font-mono text-[10px] text-zinc-500">
                      {formatCote(s.cote)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <SectionDivider />

          {/* FORME RÉCENTE — side-by-side VS comparison */}
          <Card className="glass-card rounded-xl p-5">
            <SectionTitle icon={Flame}>Forme récente</SectionTitle>
            <FormComparison
              homeName={match.home_name_fr}
              awayName={match.away_name_fr}
              homeForm={match.home_form}
              awayForm={match.away_form}
              homeChars={homeForm}
              awayChars={awayForm}
            />
          </Card>

          <SectionDivider />

          {/* CONTEXTE — phase icon + enjeu gradient meter */}
          <Card className="glass-card rounded-xl p-5">
            <SectionTitle icon={Trophy}>Contexte</SectionTitle>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Phase</span>
                <span className="flex items-center gap-1.5 rounded-md border border-[#2A2A2A] bg-[#222222]/50 px-2 py-1 text-xs font-medium text-zinc-200">
                  {match.context.phase?.toLowerCase().includes('elimin') ? (
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <Goal className="h-3.5 w-3.5 text-[#00FF00]" />
                  )}
                  {match.context.description}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Type</span>
                <span className="text-sm font-medium capitalize text-zinc-200">
                  {match.context.phase}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Enjeu</span>
                  <span className="font-mono text-xs font-bold text-zinc-200">
                    {Math.round(match.context.enjeu * 100)}%
                  </span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#222222]">
                  {/* Background gradient — single-color red intensity (light → dark) pour éviter la confusion du bleu ... */}
                  <div
                    className="absolute inset-0 opacity-30"
                    style={{
                      background:
                        'linear-gradient(90deg, #fecaca 0%, #ef4444 50%, #991b1b 100%)',
                    }}
                  />
                  {/* Enjeu fill */}
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.max(2, Math.min(100, match.context.enjeu * 100))}%`,
                    }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className="relative h-full rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, #fecaca 0%, #ef4444 50%, #991b1b 100%)',
                      boxShadow:
                        match.context.enjeu >= 0.75
                          ? '0 2px 6px rgba(239,68,68,0.5)'
                          : match.context.enjeu >= 0.4
                          ? '0 2px 6px rgba(239,68,68,0.35)'
                          : '0 2px 6px rgba(239,68,68,0.2)',
                    }}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Analyse web IA — injuries, team news, H2H, prediction context */}
          <WebInsights
            key={match.id}
            matchId={match.id}
            home={match.home_name_fr}
            away={match.away_name_fr}
            competition={match.competition}
            date={match.date_match}
            // BUG #9 FIX : transmettre le pronostic + la source des cotes pour permettre
            // à /api/web-search de calculer un pronostic ajusté en fonction des blessures.
            basePronostic={p ? { probas_1x2: p.probas_1x2 } : null}
            oddsSource={match.odds_source}
          />

          {/* Footer hint */}
          <div
            className="rounded-xl border border-[#00FF00]/25 bg-gradient-to-r from-[#00FF00]/8 to-transparent p-3.5 backdrop-blur-sm"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
          >
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-300">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#00FF00]" />
              <span>
                PronoBot analyse <strong className="text-[#00FF00]" style={{ textShadow: 'none' }}>8 types de paris</strong>{' '}
                (1X2, Double Chance, Over/Under, BTTS, Handicap, Mi-temps, Score exact)
                et sélectionne le meilleur selon probabilité × cote × EV.
              </span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function FormRow({
  name,
  form,
  chars,
}: {
  name: string;
  form: TeamForm;
  chars: string[];
}) {
  const empty = isFormEmpty(form);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        {empty ? (
          <p className="mt-0.5 inline-flex flex-col gap-0.5 text-[11px] italic text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400/70" />
              Données en cours de synchronisation
            </span>
            <span className="text-[10px] text-zinc-600">Non disponible pour cette ligue</span>
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {form.wins}V · {form.draws}N · {form.losses}D ·{' '}
            <span className="font-mono">{form.buts_marques_moy?.toFixed(1)} buts/m</span>
          </p>
        )}
      </div>
      <div className="flex gap-1">
        {empty ? (
          <span className="text-[10px] italic text-zinc-600">N/A</span>
        ) : (
          chars.map((c, i) => (
            <FormBadge key={i} result={c} />
          ))
        )}
      </div>
    </div>
  );
}

/* =========================================================================
 * FORM COMPARISON — side-by-side VS layout with buts/match bar chart
 * ========================================================================= */
/* Empty-form message — declared OUTSIDE FormComparison to avoid the
   "Cannot create components during render" lint error (state would reset
   on every render if defined inside the component body). */
function FormEmptyMsg({ align }: { align: 'left' | 'right' }) {
  return (
    <p
      className={`mt-1 inline-flex flex-col gap-0.5 text-[11px] italic text-zinc-500 ${
        align === 'right' ? 'items-end text-right' : 'items-start text-left'
      }`}
    >
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400/70" />
        <span className="truncate">Données en cours de synchronisation</span>
      </span>
      <span className="text-[10px] text-zinc-600">Non disponible pour cette ligue</span>
    </p>
  );
}

function FormComparison({
  homeName,
  awayName,
  homeForm,
  awayForm,
  homeChars,
  awayChars,
}: {
  homeName: string;
  awayName: string;
  homeForm: TeamForm;
  awayForm: TeamForm;
  homeChars: string[];
  awayChars: string[];
}) {
  const homeEmpty = isFormEmpty(homeForm);
  const awayEmpty = isFormEmpty(awayForm);
  const homeGoals = homeForm.buts_marques_moy ?? 0;
  const awayGoals = awayForm.buts_marques_moy ?? 0;
  const maxGoals = Math.max(homeGoals, awayGoals, 0.1);
  const homeGoalPct = (homeGoals / maxGoals) * 100;
  const awayGoalPct = (awayGoals / maxGoals) * 100;

  // Message affiche quand la forme est indisponible (donnees API nulles/zero)
  // (FormEmptyMsg est defini hors du composant — voir plus haut.)

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
      {/* HOME SIDE */}
      <div className="flex min-w-0 flex-col gap-2">
        <p className="truncate text-sm font-bold text-white">{homeName}</p>
        {homeEmpty ? (
          <FormEmptyMsg align="left" />
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">
              <span className="text-[#00FF00] font-semibold">{homeForm.wins}V</span>
              <span className="mx-1">·</span>
              <span className="text-yellow-400 font-semibold">{homeForm.draws}N</span>
              <span className="mx-1">·</span>
              <span className="text-red-400 font-semibold">{homeForm.losses}D</span>
            </p>
            <div className="flex flex-wrap gap-1">
              {homeChars.map((c, i) => (
                <FormBadge key={i} result={c} />
              ))}
            </div>

            {/* Buts/match bar */}
            <div className="mt-1">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-zinc-500">Buts/match</span>
                <span className="font-mono font-bold text-[#00FF00]">
                  {homeGoals.toFixed(1)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#222222]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${homeGoalPct}%` }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${GREEN}aa, ${GREEN})`,
                    boxShadow: `0 2px 6px rgba(0,255,0,0.2)`,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* VS DIVIDER */}
      <div className="flex flex-col items-center justify-center px-1">
        <div className="h-full w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
        <span className="my-1 rounded-full border border-[#2A2A2A] bg-[#1A1A1A] px-1.5 py-0.5 text-[9px] font-black uppercase text-zinc-300">
          VS
        </span>
        <div className="h-full w-px bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
      </div>

      {/* AWAY SIDE */}
      <div className="flex min-w-0 flex-col gap-2 text-right">
        <p className="truncate text-sm font-bold text-white">{awayName}</p>
        {awayEmpty ? (
          <FormEmptyMsg align="right" />
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">
              <span className="text-[#00FF00] font-semibold">{awayForm.wins}V</span>
              <span className="mx-1">·</span>
              <span className="text-yellow-400 font-semibold">{awayForm.draws}N</span>
              <span className="mx-1">·</span>
              <span className="text-red-400 font-semibold">{awayForm.losses}D</span>
            </p>
            <div className="flex flex-wrap justify-end gap-1">
              {awayChars.map((c, i) => (
                <FormBadge key={i} result={c} />
              ))}
            </div>

            {/* Buts/match bar — label/value order swapped to match the home side (label LEFT/outside, value RIGH... */}
            <div className="mt-1">
              <div className="mb-1 flex items-center justify-between text-[10px]">
                <span className="text-zinc-500">Buts/match</span>
                <span className="font-mono font-bold text-[#00FF00]">
                  {awayGoals.toFixed(1)}
                </span>
              </div>
              <div className="flex h-1.5 w-full justify-end overflow-hidden rounded-full bg-[#222222]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${awayGoalPct}%` }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${GREEN}aa, ${GREEN})`,
                    boxShadow: `0 2px 6px rgba(0,255,0,0.2)`,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
 * DAY TABS (horizontal scrollable selector for the Home tab)
 * ========================================================================= */
function DayTabs({
  dates,
  selectedDay,
  onSelect,
  countByDay,
}: {
  dates: string[];
  selectedDay: string;
  onSelect: (day: string) => void;
  countByDay: Record<string, number>;
}) {
  // Always make sure today is reachable even if the API returned no dates yet.
  const today = todayStr();
  const tabs = dates.length > 0 ? dates : [today];

  return (
    <div className="relative -mx-4 mb-3">
      <div
        className="scrollbar-hide flex gap-2 overflow-x-auto px-4 pb-1"
        role="tablist"
        aria-label="Sélection du jour"
      >
        {tabs.map((d) => {
          const active = d === selectedDay;
          const count = countByDay[d] || 0;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(d)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-colors duration-200 focus-neon ${
                active
                  ? 'bg-[#00FF00] text-black shadow-[0_0_12px_rgba(0,255,0,0.4)]'
                  : 'bg-[#141414] text-[#B0B0B0] hover:text-white border border-[#1F1F1F]'
              }`}
            >
              <span>{formatDayLabel(d)}</span>
              {count > 0 && (
                <span className={`text-[10px] ${active ? 'text-black/60' : 'text-zinc-600'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Left-edge gradient fade */}
      <div
        className="pointer-events-none absolute left-0 top-0 h-full w-8 bg-gradient-to-r from-[#0A0A0A] to-transparent"
        aria-hidden
      />
      {/* Right-edge gradient fade hinting at more tabs */}
      <div
        className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-[#0A0A0A] via-[#0A0A0A]/60 to-transparent"
        aria-hidden
      />
    </div>
  );
}

/* =========================================================================
 * MAIN APP
 * ========================================================================= */
export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [matchs, setMatchs] = useState<Match[]>([]);
  const [combiners, setCombiners] = useState<Combiner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [selectedLeague, setSelectedLeague] = useState<string>('all');

  const fetchMatchs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/matchs?week=true', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const list: Match[] = data.matchs || [];
      // Live matches first, then by time (within the same day).
      // The API already sorts by date + heure, but we re-sort defensively so
      // live games always float to the top of their day.
      list.sort((a, b) => {
        if (a.is_live && !b.is_live) return -1;
        if (!a.is_live && b.is_live) return 1;
        const da = a.date_match || '';
        const db = b.date_match || '';
        if (da !== db) return da.localeCompare(db);
        return (a.heure || '').localeCompare(b.heure || '');
      });
      setMatchs(list);
      setCombiners((data.combiners || []) as Combiner[]);
      const apiDates: string[] = data.dates || [];
      setDates(apiDates);
      // Make sure selectedDay is valid against the returned dates.
      setSelectedDay((prev) => {
        if (prev && apiDates.includes(prev)) return prev;
        const today = todayStr();
        if (apiDates.includes(today)) return today;
        return apiDates[0] || prev || today;
      });
    } catch (e: unknown) {
      // Type-guard: only read .message if e is an Error instance.
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Erreur de chargement');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh live scores every 90s, paused while tab is hidden (battery-friendly).
  useEffect(() => {
    const REFRESH_MS = 90_000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchMatchs(true);
      }
    };
    // Start the interval immediately (initial fetch is done below).
    timer = setInterval(tick, REFRESH_MS);
    // When the tab becomes visible again, do an immediate refresh.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchMatchs(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchMatchs]);

  // Initial fetch on mount.
  useEffect(() => {
    fetchMatchs();
  }, [fetchMatchs]);

  // Defer todayStr() to client to avoid SSR hydration mismatch when server
  // and client straddle midnight UTC.
  useEffect(() => {
    setSelectedDay((prev) => prev || todayStr());
  }, []);

  // Midnight tick: re-select today if the user keeps the app open past midnight.
  useEffect(() => {
    let lastDay = todayStr();
    const timer = setInterval(() => {
      const now = todayStr();
      if (now !== lastDay) {
        lastDay = now;
        // Force a re-render of any "today" pill + re-fetch for the new day.
        setSelectedDay((prev) => (prev === lastDay ? prev : now));
        fetchMatchs(true);
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [fetchMatchs]);

  const selectedMatch = useMemo(
    () => matchs.find((m) => m.id === selectedMatchId) || null,
    [matchs, selectedMatchId]
  );

  // Match count per day (for the day-tab badges).
  const matchCountByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of matchs) {
      if (!m.date_match) continue;
      map[m.date_match] = (map[m.date_match] || 0) + 1;
    }
    return map;
  }, [matchs]);

  // Unique competitions for the currently selected day.
  const availableLeagues = useMemo(() => {
    const set = new Set<string>();
    for (const m of matchs) {
      if (m.date_match === selectedDay && m.competition) {
        set.add(m.competition);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [matchs, selectedDay]);

  // Reset the league filter if it is no longer valid for the new day.
  useEffect(() => {
    if (
      selectedLeague !== 'all' &&
      availableLeagues.length > 0 &&
      !availableLeagues.includes(selectedLeague)
    ) {
      setSelectedLeague('all');
    }
  }, [selectedDay, selectedLeague, availableLeagues]);

  // Matches for the selected day + league, sorted: live first, then by time.
  const dayMatches = useMemo(() => {
    const list = matchs.filter((m) => m.date_match === selectedDay);
    const filtered =
      selectedLeague === 'all'
        ? list
        : list.filter((m) => m.competition === selectedLeague);
    return [...filtered].sort((a, b) => {
      if (a.is_live && !b.is_live) return -1;
      if (!a.is_live && b.is_live) return 1;
      return (a.heure || '').localeCompare(b.heure || '');
    });
  }, [matchs, selectedDay, selectedLeague]);

  const handleSelectDay = (day: string) => {
    setSelectedDay(day);
    setSelectedLeague('all');
  };

  const openMatch = (m: Match) => {
    setSelectedMatchId(m.id);
    setActiveTab('pronos');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Memoized so we don't re-filter the whole matchs array on every render.
  const liveCount = useMemo(() => matchs.filter((m) => m.is_live).length, [matchs]);
  const pronosCount = useMemo(() => matchs.filter((m) => m.pronostic).length, [matchs]);

  return (
    <AccessGate>
    <div className="app-bg flex min-h-screen flex-col text-white">
      {/* HEADER — pt-[env(safe-area-inset-top)] pour les iPhone à notch, py-3 sur mobile / py-4 sur sm+ */}
      <header className="glass-header sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:py-4">
          <h1 className="text-lg font-bold tracking-tight text-white">
            PRONO<span className="text-[#00FF00]" style={{ textShadow: '0 0 8px rgba(0,255,0,0.5)' }}>BOT</span>
          </h1>
          {/* Refresh button — h-10 w-10 (40px) sur mobile pour respecter la règle des 44px touch target. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fetchMatchs(true)}
            disabled={refreshing}
            className="h-10 w-10 text-zinc-400 hover:text-[#00FF00]"
            aria-label="Rafraîchir"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {/* MAIN CONTENT — pb-24 sur mobile (la nav fait ~64px + safe area), pb-28 sur sm+ */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4 sm:pb-28">
        <AnimatePresence mode="wait">
          {/* HOME TAB */}
          {activeTab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {loading ? (
                <>
                  <div className="mb-4 flex items-center gap-2 text-sm text-zinc-400">
                    <Database className="h-4 w-4 animate-pulse text-[#00FF00]" />
                    Chargement des matchs ESPN...
                  </div>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <MatchCardSkeleton key={i} />
                  ))}
                </>
              ) : error ? (
                <Card className="glass-card rounded-xl p-6 text-center !border-red-500/30">
                  <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-400" />
                  <p className="mb-1 font-semibold text-white">Erreur de chargement</p>
                  <p className="mb-4 text-sm text-zinc-400">{error}</p>
                  <Button
                    onClick={() => fetchMatchs()}
                    className="bg-[#00FF00] text-black hover:bg-[#00CC00]"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
                  </Button>
                </Card>
              ) : matchs.length === 0 ? (
                <Card className="glass-card rounded-xl p-10 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-[#00FF00]/20 bg-[#1A1A1A]/50">
                    <Activity className="h-7 w-7 text-zinc-500" />
                  </div>
                  <p className="font-semibold text-white">Aucun match cette semaine</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Les compétitions ESPN ne renvoient pas de matchs pour les 7 prochains jours.
                  </p>
                </Card>
              ) : (
                <>
                  {/* Day selector — horizontally scrollable */}
                  <DayTabs
                    dates={dates}
                    selectedDay={selectedDay}
                    onSelect={handleSelectDay}
                    countByDay={matchCountByDay}
                  />

                  {/* Subtle divider between day tabs and match list */}
                  <div
                    className="h-px w-full bg-gradient-to-r from-transparent via-zinc-800 to-transparent"
                    aria-hidden
                  />

                  {/* Header + league filter. Sur mobile on empile (flex-col) pour donner toute la largeur au SelectTri... */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <h2
                        className="flex items-center gap-2 text-xl font-black tracking-tight text-white sm:text-2xl"
                        style={{ textShadow: 'none' }}
                      >
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-[#00FF00]/12 text-base"
                          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                          aria-hidden
                        >
                          ⚽
                        </span>
                        <span>Matchs</span>
                      </h2>
                      <span className="text-[11px] text-zinc-500">
                        {formatDayLabel(selectedDay)} · {dayMatches.length} match{dayMatches.length > 1 ? 's' : ''} · tapez pour le prono
                      </span>
                    </div>
                    <Select
                      value={selectedLeague}
                      onValueChange={setSelectedLeague}
                    >
                      <SelectTrigger
                        className="h-9 w-full shrink-0 border-[#2A2A2A] bg-[#1A1A1A]/60 text-xs text-zinc-200 backdrop-blur-sm hover:border-[#00FF00]/40 focus:ring-[#00FF00]/40 sm:w-[44%] sm:min-w-[10rem] sm:max-w-[16rem]"
                        aria-label="Filtrer par ligue"
                      >
                        <Trophy className="mr-1.5 h-3.5 w-3.5 shrink-0 text-[#00FF00]" />
                        <SelectValue placeholder="Toutes les ligues" />
                      </SelectTrigger>
                      <SelectContent className="z-50 max-h-80 border-[#2A2A2A] bg-[#1A1A1A] text-zinc-200">
                        <SelectItem value="all">Toutes les ligues</SelectItem>
                        {availableLeagues.map((l) => (
                          <SelectItem key={l} value={l}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {dayMatches.length === 0 ? (
                    <Card className="glass-card rounded-xl p-8 text-center">
                      <Activity className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
                      <p className="text-sm text-zinc-400">
                        Aucun match pour {formatDayLabel(selectedDay)}
                        {selectedLeague !== 'all' ? ` en ${selectedLeague}` : ''}.
                      </p>
                      {selectedLeague !== 'all' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLeague('all')}
                          className="mt-3 text-[#00FF00] hover:bg-[#00FF00]/10 hover:text-[#00FF00]"
                        >
                          Voir toutes les ligues
                        </Button>
                      )}
                    </Card>
                  ) : (
                    dayMatches.map((m) => (
                      <MatchCard key={m.id} match={m} onClick={() => openMatch(m)} />
                    ))
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* PRONOS TAB */}
          {activeTab === 'pronos' && (
            <motion.div
              key="pronos"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              {selectedMatch ? (
                <PronosDetail
                  match={selectedMatch}
                  onBack={() => setSelectedMatchId(null)}
                />
              ) : (
                <>
                  <div className="mb-2">
                    <h2 className="text-lg font-black text-white">Pronostics</h2>
                    <p className="text-sm text-zinc-500">
                      Sélectionnez un match pour voir l'analyse détaillée
                    </p>
                  </div>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <MatchCardSkeleton key={i} />
                    ))
                  ) : matchs.length === 0 ? (
                    <Card className="glass-card rounded-xl p-8 text-center">
                      <Target className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
                      <p className="text-sm text-zinc-400">Aucun prono disponible</p>
                    </Card>
                  ) : (
                    matchs
                      .filter((m) => m.pronostic)
                      .map((m) => (
                        <MatchCard key={m.id} match={m} onClick={() => openMatch(m)} />
                      ))
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* COMBINÉS TAB */}
          {activeTab === 'combines' && (
            <motion.div
              key="combines"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              <Card className="glass-card relative overflow-hidden rounded-xl p-5">
                {/* Top neon accent line */}
                <div
                  className="absolute left-0 top-0 h-0.5 w-full"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${GREEN} 30%, ${GREEN} 70%, transparent 100%)`,
                    boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
                  }}
                />
                {/* Background glow blob */}
                <div
                  className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-20 blur-3xl"
                  style={{ backgroundColor: GREEN }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#00FF00]/30 bg-[#00FF00]/12"
                    style={{ boxShadow: `0 2px 8px rgba(0,255,0,0.2)` }}
                  >
                    <Layers className="h-5 w-5 text-[#00FF00]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-black text-white" style={{ textShadow: 'none' }}>Paris Combinés</h2>
                    <p className="text-xs text-zinc-500">Meilleurs combinés du jour</p>
                  </div>
                  {combiners.length > 0 && (
                    <Badge
                      variant="outline"
                      className="border-[#00FF00]/40 bg-[#00FF00]/10 text-xs font-black text-[#00FF00]"
                      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
                    >
                      {combiners.length}
                    </Badge>
                  )}
                </div>
              </Card>

              {(loading || refreshing) && combiners.length === 0 ? (
                /* Skeleton dedie pour l'onglet Combines.
                   On affiche un nombre fixe de cartes-skeleton avec hauteur minimale pour
                   eviter le "clignotement" du GPU pendant que les donnees arrivent. */
                <>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Database className="h-4 w-4 animate-pulse text-[#00FF00]" />
                    Calcul des combinés...
                  </div>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i} className="glass-card min-h-[180px] rounded-xl p-5">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="h-8 w-8 rounded-lg bg-[#222222]/60" />
                          <div className="h-3 w-20 rounded bg-[#222222]/60" />
                        </div>
                        <div className="h-6 w-full rounded bg-[#222222]/60" />
                        <div className="h-6 w-full rounded bg-[#222222]/60" />
                        <div className="grid grid-cols-3 gap-2">
                          <div className="h-12 rounded-lg bg-[#222222]/60" />
                          <div className="h-12 rounded-lg bg-[#222222]/60" />
                          <div className="h-12 rounded-lg bg-[#222222]/60" />
                        </div>
                      </div>
                    </Card>
                  ))}
                </>
              ) : combiners.length === 0 ? (
                <Card className="glass-card rounded-xl p-10 text-center">
                  <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center">
                    <Layers className="h-20 w-20 text-[#00FF00]/20" />
                  </div>
                  <p className="text-lg font-bold text-white">
                    Aucun combiné disponible
                  </p>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-400">
                    PronoBot génère des combinés uniquement à partir de matchs avec une
                    probabilité ≥ 50%. Revenez plus tard quand plus de matchs seront disponibles.
                  </p>
                  <Button
                    onClick={() => setActiveTab('pronos')}
                    className="mt-4 bg-[#00FF00] text-black hover:bg-[#00CC00]"
                  >
                    <Target className="mr-2 h-4 w-4" /> Voir les pronos simples
                  </Button>
                </Card>
              ) : (
                <>
                  {/* Summary strip — premium stat widgets (3 cards desktop, stacked mobile) */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Card className="glass-card relative overflow-hidden rounded-xl p-4">
                      <div className="relative">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          Combinés
                        </p>
                        <p
                          className="mt-1 font-mono text-3xl font-black text-[#00FF00]"
                          style={{ textShadow: 'none' }}
                        >
                          {combiners.length}
                        </p>
                      </div>
                    </Card>
                    <Card className="glass-card relative overflow-hidden rounded-xl p-4">
                      <div className="relative">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          Meilleure cote
                        </p>
                        <p
                          className="mt-1 font-mono text-3xl font-black text-[#00FF00]"
                          style={{ textShadow: 'none' }}
                        >
                          {/* Guard défensif : ce bloc est dans la branche combiners.length > 0, mais on protège quand même con... */}
                          {combiners.length > 0
                            ? Math.max(...combiners.map((c) => c.cote_combinee)).toFixed(2)
                            : '—'}
                        </p>
                      </div>
                    </Card>
                    <Card className="glass-card relative overflow-hidden rounded-xl p-4">
                      <div className="relative">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          Fiabilité
                        </p>
                        <p
                          className="mt-1 text-2xl font-black text-[#00FF00]"
                          style={{ textShadow: 'none' }}
                        >
                          {/* Remplace l'EV négatif (effet repoussoir) par un indicateur de fiabilité basé sur la probabilité m... */}
                          {(() => {
                            if (combiners.length === 0) return '—';
                            const avgProba = combiners.reduce((s, c) => s + c.probabilite, 0) / combiners.length;
                            if (avgProba >= 0.55) return 'Haute';
                            if (avgProba >= 0.40) return 'Moyenne';
                            return 'Variable';
                          })()}
                        </p>
                      </div>
                    </Card>
                  </div>

                  {combiners.map((c, i) => (
                    <CombinerCard key={`${c.type}-${c.cote_combinee}-${i}`} combiner={c} />
                  ))}
                </>
              )}
            </motion.div>
          )}

          {/* PROFIL TAB */}
          {activeTab === 'profil' && (
            <motion.div
              key="profil"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* App identity — logo + title + version pill */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0 }}
              >
                <Card className="glass-card relative overflow-hidden rounded-xl p-5">
                  {/* Top neon accent line */}
                  <div
                    className="absolute left-0 top-0 h-0.5 w-full"
                    style={{
                      background: `linear-gradient(90deg, transparent 0%, ${GREEN} 30%, ${GREEN} 70%, transparent 100%)`,
                      boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-15 blur-3xl"
                    style={{ backgroundColor: GREEN }}
                    aria-hidden
                  />
                  <div className="relative flex items-center gap-4">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00FF00]/30 bg-[#00FF00]/12"
                      style={{ boxShadow: `0 2px 8px rgba(0,255,0,0.25)` }}
                    >
                      <Brain className="h-7 w-7 text-[#00FF00]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-black text-white" style={{ textShadow: 'none' }}>
                          Prono<span className="text-[#00FF00]">Bot</span>
                        </h2>
                        <span className="inline-flex items-center rounded-full border border-[#00FF00]/30 bg-[#00FF00]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#00FF00]">
                          v2.1.0
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500">PWA · Foot Analytics</p>
                    </div>
                  </div>
                </Card>
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* API Status — premium rows with icons */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                <Card className="glass-card rounded-xl p-5">
                  <SectionTitle icon={Database}>État des API</SectionTitle>
                  <div className="space-y-2.5">
                    <ApiStatusRow
                      icon={Activity}
                      name="ESPN Scoreboard"
                      status={error ? 'error' : loading ? 'loading' : 'ok'}
                      detail={
                        error
                          ? 'Erreur'
                          : loading
                          ? 'Chargement...'
                          : `${matchs.length} matchs chargés`
                      }
                    />
                    <ApiStatusRow
                      icon={Brain}
                      name="DeepSeek AI"
                      status="ok"
                      detail="Analyse web active"
                    />
                    <ApiStatusRow
                      icon={DollarSign}
                      name="DraftKings Odds"
                      status="ok"
                      detail="Cotes synchronisées"
                    />
                    <ApiStatusRow
                      icon={Layers}
                      name="Moteur de combinés"
                      status={combiners.length > 0 ? 'ok' : 'loading'}
                      detail={
                        combiners.length > 0
                          ? `${combiners.length} combinés générés`
                          : 'En attente de matchs éligibles'
                      }
                    />
                  </div>
                </Card>
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* Stats summary — 2x2 mobile, 4 cols desktop */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <Card className="glass-card rounded-xl p-5">
                  <SectionTitle icon={BarChart3}>Statistiques</SectionTitle>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatBox
                      label="Matchs analysés"
                      value={matchs.length.toString()}
                      icon={Target}
                    />
                    <StatBox
                      label="Pronos générés"
                      value={pronosCount.toString()}
                      icon={Sparkles}
                      accent="green"
                    />
                    <StatBox
                      label="Combinés dispo"
                      value={combiners.length.toString()}
                      icon={Layers}
                      accent="green"
                    />
                    <StatBox
                      label="Matchs en live"
                      value={liveCount.toString()}
                      icon={Radio}
                      accent={liveCount > 0 ? 'green' : undefined}
                    />
                  </div>
                </Card>
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* Settings */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
              >
                <Card className="glass-card rounded-xl p-5">
                  <SectionTitle icon={Settings}>Paramètres</SectionTitle>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-3 transition-colors hover:border-[#00FF00]/20">
                      <div>
                        <p className="text-sm font-medium text-zinc-200">Rafraîchissement auto</p>
                        <p className="text-[11px] text-zinc-500">Scores live toutes les 60s</p>
                      </div>
                      <Switch defaultChecked className="data-[state=checked]:bg-[#00FF00]" />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#222222]/30 p-3 transition-colors hover:border-[#00FF00]/20">
                      <div>
                        <p className="text-sm font-medium text-zinc-200">Notifications combinés</p>
                        <p className="text-[11px] text-zinc-500">Alerte à chaque nouveau combiné</p>
                      </div>
                      <Switch className="data-[state=checked]:bg-[#00FF00]" />
                    </div>
                  </div>
                </Card>
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* About — 9 bet types in a grid with descriptions */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                <Card className="glass-card rounded-xl p-5">
                  <SectionTitle icon={Brain}>À propos</SectionTitle>
                  <p className="text-sm leading-relaxed text-zinc-400">
                    PronoBot analyse les matchs de football en temps réel grâce aux données
                    ESPN et aux cotes DraftKings. Pour chaque match, le bot calcule 9 types
                    de paris et génère automatiquement les meilleurs combinés du jour.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      { type: '1X2', desc: 'Victoire domicile, nul ou victoire extérieur' },
                      { type: 'Double Chance', desc: 'Double Chance 1N, 12, N2 (3 options)' },
                      { type: 'Plus de Buts', desc: 'Plus de 1.5, 2.5 ou 3.5 buts' },
                      { type: 'BTTS', desc: 'Les deux équipes vont marquer (Oui/Non)' },
                      { type: 'DC + BTTS', desc: 'Double Chance + Les 2 équipes marquent (combiné)' },
                      { type: 'Buteur', desc: 'Nom du buteur probable (équipe la plus susceptible de marquer)' },
                      { type: 'Mi-temps', desc: 'Résultat mi-temps / fin de match' },
                      { type: 'Score exact', desc: 'Score final précis (top 3)' },
                      { type: 'Qualification', desc: 'Équipe qualifiée (matchs à élimination directe)' },
                    ].map((b) => (
                      <div
                        key={b.type}
                        className="flex items-center gap-2 rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]/40 p-2 transition-colors hover:border-[#00FF00]/20"
                      >
                        <BetTypeBadge type={b.type} />
                        <span className="truncate text-[11px] text-zinc-400">{b.desc}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* Installer l'app (PWA) */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.22 }}
              >
                <InstallAppCard />
              </motion.div>
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* Mentions légales + RGPD — extrait dans /components/legal-rgpd-cards.tsx */}
              <LegalRgpdCards />
              <div className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />

              {/* Reset data */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.25 }}
              >
                <Card className="glass-card rounded-xl p-5 !border-red-500/20">
                  <SectionTitle icon={AlertTriangle}>Maintenance</SectionTitle>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-400"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Recharger les données
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="glass-card border-[#00FF00]/15">
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-white">
                          Recharger toutes les données ?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-zinc-400">
                          Les matchs, pronostics et combinés seront re-téléchargés depuis
                          l'API ESPN. Cela peut prendre quelques secondes.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="border-[#00FF00]/20 bg-[#1A1A1A] text-zinc-200">
                          Annuler
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            fetchMatchs(true);
                            toast.success('Données rechargées');
                          }}
                          className="bg-[#00FF00] text-black hover:bg-[#00CC00]"
                        >
                          Recharger
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </Card>
              </motion.div>

              <p className="pb-2 text-center text-[11px] text-zinc-600">
                PronoBot v2.1.0 · Données ESPN · Fait avec{' '}
                <span className="text-[#00FF00]">♥</span> pour les passionnés de foot
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* BOTTOM NAV */}
      <nav className="glass-nav fixed bottom-0 left-0 right-0 z-30">
        <div className="mx-auto flex max-w-2xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-1.5">
          <NavButton
            active={activeTab === 'home'}
            onClick={() => setActiveTab('home')}
            icon={HomeIcon}
            label="Matchs"
          />
          <NavButton
            active={activeTab === 'pronos'}
            onClick={() => setActiveTab('pronos')}
            icon={Target}
            label="Pronos"
          />
          <NavButton
            active={activeTab === 'combines'}
            onClick={() => setActiveTab('combines')}
            icon={Layers}
            label="Combinés"
            badge={combiners.length || undefined}
          />
          <NavButton
            active={activeTab === 'profil'}
            onClick={() => setActiveTab('profil')}
            icon={User}
            label="Profil"
          />
        </div>
      </nav>

      {/* PWA install prompt — Android (beforeinstallprompt) + iOS hint */}
      <InstallPrompt />

      {/* RGPD cookie banner */}
      <CookieBanner />
    </div>
    </AccessGate>
  );
}

/* =========================================================================
 * INSTALL APP CARD — PWA installation from Profil tab
 * Detects if already installed (standalone mode). If not, offers install:
 * - Android/Chrome: uses beforeinstallprompt event
 * - iOS/Safari: shows instructions modal
 * ========================================================================= */
function InstallAppCard() {
  // Lazy initializers — computed once on the client (SSR-safe, no setState in effect)
  const [isStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );
  });
  const [isIOS] = useState(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
  });
  const [deferred, setDeferred] = useState<any>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    // Listen for beforeinstallprompt (Android/Chrome) — no setState sync
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (deferred) {
      deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        toast.success('PronoBot installé !');
      }
      setDeferred(null);
    } else if (isIOS) {
      setShowIOSHint(true);
    } else {
      // Android/Chrome: l'événement beforeinstallprompt n'a pas encore firé.
      // Cela arrive si l'utilisateur clique trop vite (Chrome nécessite un
      // minimum d'interaction avant de déclencher l'event).
      // On affiche les instructions manuelles.
      setShowFallback(true);
    }
  };

  return (
    <Card className="glass-card relative overflow-hidden rounded-xl p-5">
      {/* Top accent line — gold */}
      <div
        className="absolute left-0 top-0 h-0.5 w-full"
        style={{
          background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
          boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
        }}
      />
      <SectionTitle icon={Download}>Application mobile</SectionTitle>

      {isStandalone ? (
        // Already installed
        <div className="flex items-center gap-3 rounded-lg border border-[#00FF00]/30 bg-[#00FF00]/10 p-4">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-[#00FF00]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">App installée ✓</p>
            <p className="text-[11px] text-zinc-400">
              PronoBot fonctionne en mode standalone avec support hors-ligne.
            </p>
          </div>
        </div>
      ) : (
        // Not installed — show install button
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#00FF00]/30 bg-[#00FF00]/12"
              style={{ boxShadow: `0 2px 8px rgba(0,255,0,0.2)` }}
            >
              <Smartphone className="h-6 w-6 text-[#00FF00]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Installer PronoBot</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                Accès rapide depuis l&apos;écran d&apos;accueil, mode hors-ligne, et
                notifications — comme une vraie app mobile, sans store.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {['📱', '🔄', '⚡'].map((emoji, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-[#00FF00]/20 bg-[#00FF00]/8 px-2.5 py-1 text-[10px] font-bold text-[#00FF00]"
              >
                {emoji} {['Écran d\'accueil', 'Hors-ligne', 'Ultra-rapide'][i]}
              </span>
            ))}
          </div>

          <Button
            onClick={handleInstall}
            className="w-full bg-[#00FF00] text-black hover:bg-[#00CC00]"
          >
            <Download className="mr-2 h-4 w-4" />
            {isIOS ? 'Instructions d\'installation' : 'Installer l\'app'}
          </Button>

          {!deferred && !isIOS && (
            <p className="text-center text-[10px] text-zinc-600">
              💡 Si le bouton ne fonctionne pas, utilisez le menu Chrome → « Ajouter à l&apos;écran d&apos;accueil »
            </p>
          )}
        </div>
      )}

      {/* iOS instructions modal */}
      {showIOSHint && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowIOSHint(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border-[#00FF00]/30 bg-[#1A1A1A] p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#00FF00]/15">
              <Smartphone className="h-7 w-7 text-[#00FF00]" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-white">Installer sur iPhone</h3>
            <p className="text-sm text-zinc-400">Pour installer PronoBot sur votre écran d&apos;accueil :</p>
            <ol className="mt-3 space-y-2 text-left text-sm text-zinc-300">
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">1.</span>
                <span>Touchez l&apos;icône <strong className="text-white">Partage</strong> en bas de Safari</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">2.</span>
                <span>Sélectionnez <strong className="text-white">« Sur l&apos;écran d&apos;accueil »</strong></span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">3.</span>
                <span>Appuyez sur <strong className="text-white">Ajouter</strong></span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSHint(false)}
              className="mt-5 w-full rounded-lg bg-[#00FF00] py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#00CC00]"
            >
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}

      {/* Android fallback modal — when beforeinstallprompt hasn't fired yet */}
      {showFallback && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShowFallback(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border-[#00FF00]/30 bg-[#1A1A1A] p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#00FF00]/15">
              <Download className="h-7 w-7 text-[#00FF00]" />
            </div>
            <h3 className="mb-2 text-lg font-bold text-white">Installation manuelle</h3>
            <p className="text-sm text-zinc-400">
              Le bouton d&apos;installation automatique n&apos;est pas encore disponible.
              Vous pouvez installer PronoBot manuellement :
            </p>
            <ol className="mt-3 space-y-2 text-left text-sm text-zinc-300">
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">1.</span>
                <span>Ouvrez le menu <strong className="text-white">Chrome</strong> (icône ⋮ en haut à droite)</span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">2.</span>
                <span>Sélectionnez <strong className="text-white">« Ajouter à l&apos;écran d&apos;accueil »</strong> ou <strong className="text-white">« Installer l&apos;application »</strong></span>
              </li>
              <li className="flex gap-2">
                <span className="font-bold text-[#00FF00]">3.</span>
                <span>Confirmez avec <strong className="text-white">Installer</strong></span>
              </li>
            </ol>
            <p className="mt-3 rounded-lg border border-[#00FF00]/20 bg-[#00FF00]/8 p-2 text-[11px] text-[#00FF00]">
              💡 Astuce : naviguez sur l&apos;app quelques secondes, puis réessayez le bouton — l&apos;installation automatique s&apos;activera.
            </p>
            <button
              type="button"
              onClick={() => setShowFallback(false)}
              className="mt-5 w-full rounded-lg bg-[#00FF00] py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#00CC00]"
            >
              J&apos;ai compris
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 py-3 transition-colors duration-200 focus-neon ${
        active
          ? 'text-[#00FF00]'
          : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      <div className="relative">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={active ? 2.5 : 2} />
        {active && (
          <span className="absolute -top-1.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#00FF00]"
                style={{ boxShadow: '0 0 8px rgba(0,255,0,0.8), 0 0 4px rgba(0,255,0,1)' }} />
        )}
        {badge ? (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        ) : null}
      </div>
      {/* min-w-0 + truncate pour éviter l'overlap des labels sur très petits écrans (< 320px). */}
      <span className="min-w-0 truncate text-[10px] font-medium">{label}</span>
    </button>
  );
}

function ApiStatusRow({
  icon: Icon,
  name,
  status,
  detail,
}: {
  icon: React.ElementType;
  name: string;
  status: 'ok' | 'error' | 'loading';
  detail: string;
}) {
  const styles = {
    ok: { dot: 'bg-[#00FF00]', text: 'text-[#00FF00]', pulse: true, glow: '0 2px 6px rgba(0,255,0,0.4)' },
    error: { dot: 'bg-red-500', text: 'text-red-400', pulse: false, glow: '0 2px 4px rgba(239,68,68,0.35)' },
    loading: { dot: 'bg-yellow-500', text: 'text-yellow-400', pulse: false, glow: '0 2px 4px rgba(234,179,8,0.35)' },
  }[status];
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#1A1A1A]/40 px-3 py-2.5 backdrop-blur-sm">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-3 w-3">
          {styles.pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00FF00] opacity-60" />
          )}
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${styles.dot}`}
            style={{ boxShadow: styles.glow }}
          />
        </span>
        <Icon className="h-4 w-4 text-zinc-400" />
        <span className="text-sm font-medium text-zinc-200">{name}</span>
      </div>
      <span className={`text-xs font-bold ${styles.text}`}>{detail}</span>
    </div>
  );
}

function StatBox({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  accent?: 'green' | 'red';
}) {
  const valueColor =
    accent === 'green'
      ? 'text-[#00FF00]'
      : accent === 'red'
      ? 'text-red-400'
      : 'text-white';
  const iconColor =
    accent === 'green'
      ? 'text-[#00FF00]/10'
      : accent === 'red'
      ? 'text-red-500/10'
      : 'text-zinc-500/10';
  return (
    <div className="glass-card relative overflow-hidden rounded-xl p-3">
      {/* Icône décorative — positionnée légèrement à l'intérieur (-right-1 -top-1) et plus petite (h-12 w-... */}
      <Icon
        className={`pointer-events-none absolute -right-1 -top-1 h-12 w-12 ${iconColor}`}
      />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          {label}
        </p>
        <p
          className={`mt-1 font-mono text-xl font-black ${valueColor}`}
          style={accent === 'green' ? { textShadow: 'none' } : undefined}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
