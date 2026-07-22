'use client';

import { useState } from 'react';
import { Brain, Database, AlertCircle, Sparkles, Globe, RefreshCw, Trophy, Target } from 'lucide-react';
import { Card } from '@/components/ui/card';

// ────────────────────────────────────────────────────────────────────────────
// WebInsights — fetches /api/web-search for match context (injuries, news, H2H,
// prediction_context). ON-DEMAND: shows a button first, fetches only when the
// user clicks. Visualises results in a gold-themed card inside the PronosDetail
// view. Has loading, error, empty, and success states.
// ────────────────────────────────────────────────────────────────────────────

export interface WebInsightsData {
  summary: string;
  injuries: Array<{
    team: string;
    player: string;
    reason: string;
    impact: string;
  }>;
  team_news: Array<{ team: string; news: string }>;
  h2h: string;
  prediction_context: string;
  score_predictions?: {
    consensus: string;
    confidence: 'high' | 'medium' | 'low';
    sources_summary: string;
    alternative_scores: string[];
  };
  goalscorers?: { top_scorer: string; top_scorer_team: 'home' | 'away'; confidence: 'high' | 'medium' | 'low'; alternative_scorers: string[]; reasoning: string; expert_source?: string };
  sources: Array<{ title: string; snippet: string; url: string }>;
  source?: 'sdk' | 'duckduckgo' | 'none';
  error?: string;
  // BUG #9 FIX : pronostic ajusté en fonction des blessures (si cotes estimées).
  adjusted_pronostic?: {
    applied: boolean;
    reason: string;
    probas_1x2?: { prob_1: number; prob_N: number; prob_2: number };
    original_probas_1x2?: { prob_1: number; prob_N: number; prob_2: number };
    adjustments?: Array<{ team: 'home' | 'away'; player: string; impact: string; delta: number }>;
    summary?: string;
  } | null;
}

export interface WebInsightsProps {
  /** Stable key — when this changes, the component remounts and refetches. */
  matchId: string;
  home: string;
  away: string;
  competition?: string;
  date?: string;
  // BUG #9 FIX : pronostic de base + source des cotes pour calcul d'ajustement.
  basePronostic?: { probas_1x2: { prob_1: number; prob_N: number; prob_2: number } } | null;
  oddsSource?: string;
}

function impactStyle(impact: string): { label: string; bg: string; text: string; border: string } {
  switch (impact?.toLowerCase()) {
    case 'high': return { label: 'Impact élevé', bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/40' };
    case 'medium': return { label: 'Impact moyen', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/40' };
    default: return { label: 'Impact faible', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/40' };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SECURITY HELPERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a URL string is a safe http(s) URL.
 *
 * The /api/web-search endpoint returns `sources` whose URLs come from external
 * search results (DuckDuckGo / SDK). While those upstream providers should
 * only return http(s) URLs, an attacker who compromises the upstream could
 * inject a `javascript:` URL — clicking it would execute arbitrary JS in the
 * user's browser (XSS). This defence-in-depth check rejects anything that
 * isn't explicitly http: or https:.
 */
function isSafeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (!url) return false;
  // Only allow http(s) — reject javascript:, data:, vbscript:, file:, etc.
  // Use a case-insensitive check on the scheme.
  return /^https?:\/\//i.test(url);
}

/**
 * Sanitize free-form text returned by the LLM before rendering.
 *
 * React escapes text by default, so JSX rendering of `{value}` is already
 * safe against HTML injection. This function is a thin wrapper that:
 *   - coerces non-strings to '' (defends against the LLM returning a number
 *     or object where the UI expects a string)
 *   - caps the length to prevent UI breakage on very long LLM outputs.
 */
function sanitizeText(value: unknown, maxLen = 2000): string {
  if (typeof value !== 'string') return '';
  // Strip null bytes (can be used to bypass naive filters) + cap length.
  return value.replace(/\u0000/g, '').slice(0, maxLen);
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

export function WebInsights({
  matchId,
  home,
  away,
  competition,
  date,
  basePronostic,
  oddsSource,
}: WebInsightsProps) {
  const [data, setData] = useState<WebInsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = () => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    fetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // BUG #9 FIX : envoyer base_pronostic + odds_source pour récupérer un pronostic ajusté.
      body: JSON.stringify({
        home, away, competition, date,
        base_pronostic: basePronostic || undefined,
        odds_source: oddsSource,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: WebInsightsData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message || 'Erreur');
        setLoading(false);
      });
  };

  // Reset state when matchId changes (user navigates to a different match).
  // The parent uses a key prop too, but we also reset here as a safety net.
  const [lastMatchId, setLastMatchId] = useState(matchId);
  if (matchId !== lastMatchId) {
    setLastMatchId(matchId);
    setData(null);
    setLoading(false);
    setError(null);
    setHasSearched(false);
  }

  // ═══ STATE 1: Initial — show the button ═══
  if (!hasSearched && !loading && !data) {
    return (
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        <div
          className="absolute left-0 top-0 h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
            boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
          }}
        />
        <div className="relative flex flex-col items-center gap-3 py-2 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#00FF00]/30 bg-[#00FF00]/12"
            style={{ boxShadow: `0 2px 8px rgba(0,255,0,0.2)` }}
          >
            <Globe className="h-6 w-6 text-[#00FF00]" />
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">Analyse web IA</h3>
            <p className="mt-1 text-xs text-zinc-500">Rechercher les infos chaudes sur le web : blessures, actus, confrontations directes</p>
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#00FF00]/40 bg-[#00FF00]/15 px-4 py-2.5 text-sm font-bold text-[#00FF00] transition-all hover:bg-[#00FF00]/25 hover:border-[#00FF00]/60 focus:outline-none focus:ring-2 focus:ring-[#00FF00]/40 disabled:opacity-50"
            aria-label="Rechercher les infos chaudes sur le web"
          >
            <Globe className="h-4 w-4" /> Rechercher les infos chaudes sur le Web <span aria-hidden>🌐</span>
          </button>
          <p className="text-[10px] text-zinc-600">Analyse contextuelle par IA · ~5-10s</p>
        </div>
      </Card>
    );
  }

  // ═══ STATE 2: Loading ═══
  if (loading) {
    return (
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        <div
          className="absolute left-0 top-0 h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
            boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
          }}
        />
        <SectionTitle icon={Brain}>Analyse web IA</SectionTitle>
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-400">
          <Database className="h-4 w-4 animate-pulse text-[#00FF00]" />
          <span className="truncate">Recherche d&apos;informations sur {home} vs {away}...</span>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full rounded shimmer" />
          <div className="h-3 w-3/4 rounded shimmer" />
          <div className="h-3 w-5/6 rounded shimmer" />
        </div>
      </Card>
    );
  }

  // ═══ STATE 3: Error ═══
  if (error || !data || data.error) {
    return (
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        <div
          className="absolute left-0 top-0 h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
          }}
        />
        <SectionTitle icon={AlertCircle}>Analyse web</SectionTitle>
        <p className="mb-3 text-sm text-zinc-400">
          {error || data?.error || 'Analyse indisponible pour ce match.'}
        </p>
        <button
          type="button"
          onClick={handleSearch}
          className="inline-flex items-center gap-2 rounded-lg border border-[#00FF00]/40 bg-[#00FF00]/15 px-3 py-2 text-xs font-bold text-[#00FF00] transition-all hover:bg-[#00FF00]/25"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </Card>
    );
  }

  // ═══ STATE 4: Empty results ═══
  const hasAny =
    data.summary ||
    (data.injuries && data.injuries.length > 0) ||
    (data.team_news && data.team_news.length > 0) ||
    data.h2h ||
    data.prediction_context ||
    (data.score_predictions && data.score_predictions.consensus) ||
    (data.goalscorers && data.goalscorers.top_scorer);

  if (!hasAny) {
    return (
      <Card className="glass-card relative overflow-hidden rounded-xl p-5">
        <div
          className="absolute left-0 top-0 h-0.5 w-full"
          style={{
            background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
          }}
        />
        <SectionTitle icon={AlertCircle}>Analyse web</SectionTitle>
        <p className="mb-3 text-sm text-zinc-400">
          Aucune information récente trouvée pour ce match.
        </p>
        <button
          type="button"
          onClick={handleSearch}
          className="inline-flex items-center gap-2 rounded-lg border border-[#00FF00]/40 bg-[#00FF00]/15 px-3 py-2 text-xs font-bold text-[#00FF00] transition-all hover:bg-[#00FF00]/25"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Relancer la recherche
        </button>
      </Card>
    );
  }

  // ═══ STATE 5: Success — show results ═══
  return (
    <Card className="glass-card relative overflow-hidden rounded-xl p-5">
      <div
        className="absolute left-0 top-0 h-0.5 w-full"
        style={{
          background: `linear-gradient(90deg, transparent 0%, #00FF00 30%, #00FF00 70%, transparent 100%)`,
          boxShadow: `0 2px 8px rgba(0,255,0,0.3)`,
        }}
      />
      <div className="relative mb-3 flex items-center justify-between gap-2">
        <SectionTitle icon={Brain}>Analyse web IA</SectionTitle>
        <button
          type="button"
          onClick={handleSearch}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#00FF00]/30 bg-[#00FF00]/10 px-2 py-1 text-[10px] font-bold text-[#00FF00] transition-all hover:bg-[#00FF00]/20"
          title="Relancer la recherche"
        >
          <RefreshCw className="h-3 w-3" />
          Actualiser
        </button>
      </div>

      <div className="space-y-4">
        {/* Summary */}
        {data.summary && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]/80">
              Résumé
            </p>
            <p className="text-sm leading-relaxed text-zinc-300">
              {sanitizeText(data.summary)}
            </p>
          </div>
        )}

        {/* Buteur probable — orange theme, real player name from web search */}
        {data.goalscorers && data.goalscorers.top_scorer && (
          <div className="rounded-lg border border-orange-500/30 bg-gradient-to-r from-orange-500/10 to-transparent p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-400">
              <Target className="h-3 w-3" /> Buteur probable
            </p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-black text-orange-400" style={{ textShadow: '0 0 8px rgba(249,115,22,0.5)' }}>
                {sanitizeText(data.goalscorers.top_scorer, 60)}
              </span>
              <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-400">
                {data.goalscorers.top_scorer_team === 'home' ? home : away}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                data.goalscorers.confidence === 'high' ? 'bg-orange-500/20 text-orange-400' :
                data.goalscorers.confidence === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-500/20 text-zinc-400'
              }`}>
                {data.goalscorers.confidence === 'high' ? 'Confiance haute' : data.goalscorers.confidence === 'medium' ? 'Confiance moyenne' : 'Confiance faible'}
              </span>
            </div>
            {data.goalscorers.alternative_scorers && data.goalscorers.alternative_scorers.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">Autres:</span>
                {data.goalscorers.alternative_scorers.map((name, i) => (
                  <span key={i} className="rounded-md border border-orange-500/20 bg-orange-500/8 px-1.5 py-0.5 text-[11px] font-bold text-orange-400">
                    {sanitizeText(name, 40)}
                  </span>
                ))}
              </div>
            )}
            {data.goalscorers.reasoning && (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                {sanitizeText(data.goalscorers.reasoning, 500)}
              </p>
            )}
            {data.goalscorers.expert_source && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-orange-400/80">
                <Globe className="h-2.5 w-2.5" />
                Source experte&nbsp;: {sanitizeText(data.goalscorers.expert_source, 60)}
              </p>
            )}
          </div>
        )}

        {/* BUG #9 FIX : Pronostic ajusté en fonction des blessures */}
        {data.adjusted_pronostic && data.adjusted_pronostic.applied && data.adjusted_pronostic.probas_1x2 && (
          <div className="rounded-lg border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-transparent p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
              <AlertCircle className="h-3 w-3" /> Pronostic ajusté (blessures)
            </p>
            {data.adjusted_pronostic.summary && (
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-300">
                {sanitizeText(data.adjusted_pronostic.summary, 500)}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Victoire ' + home, short: '1', prob: data.adjusted_pronostic.probas_1x2.prob_1, orig: data.adjusted_pronostic.original_probas_1x2?.prob_1 },
                { label: 'Nul', short: 'N', prob: data.adjusted_pronostic.probas_1x2.prob_N, orig: data.adjusted_pronostic.original_probas_1x2?.prob_N },
                { label: 'Victoire ' + away, short: '2', prob: data.adjusted_pronostic.probas_1x2.prob_2, orig: data.adjusted_pronostic.original_probas_1x2?.prob_2 },
              ].map((item) => {
                const delta = item.orig !== undefined ? item.prob - item.orig : 0;
                const deltaPct = (delta * 100).toFixed(1);
                const deltaColor = delta > 0.001 ? 'text-emerald-400' : delta < -0.001 ? 'text-red-400' : 'text-zinc-500';
                const deltaSign = delta > 0 ? '+' : '';
                return (
                  <div key={item.short} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-center">
                    <p className="text-[10px] font-bold uppercase text-amber-400/80">{item.short}</p>
                    <p className="font-mono text-xl font-black text-white">
                      {(item.prob * 100).toFixed(1)}%
                    </p>
                    {item.orig !== undefined && (
                      <p className={`text-[10px] font-bold ${deltaColor}`}>
                        {deltaSign}{deltaPct}%
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {data.adjusted_pronostic.adjustments && data.adjusted_pronostic.adjustments.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400/80">Ajustements appliqués</p>
                {data.adjusted_pronostic.adjustments.map((adj, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-400">
                      {adj.team === 'home' ? home : away}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-white">
                      {sanitizeText(adj.player, 100)}
                    </span>
                    <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                      {(adj.delta * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10px] italic text-zinc-500">
              Ajustement appliqué car les cotes sont estimées (pas réelles). Pour les cotes réelles, les blessures sont déjà pricées par le marché.
            </p>
          </div>
        )}

        {/* BUG #9 FIX : message info si cotes réelles (blessures déjà pricées) */}
        {data.adjusted_pronostic && !data.adjusted_pronostic.applied && data.adjusted_pronostic.reason === 'real_odds' && data.injuries && data.injuries.length > 0 && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-300">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
              <span>
                <strong className="text-emerald-400">Blessures déjà pricées</strong> — les cotes réelles
                ({oddsSource || 'marché'}) reflètent déjà les blessures listées ci-dessus. Aucun ajustement appliqué pour éviter le double comptage.
              </span>
            </p>
          </div>
        )}

        {/* Injuries */}
        {data.injuries && data.injuries.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]/80">
              Blessures &amp; suspensions
            </p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {data.injuries.map((inj, i) => {
                const isHome = inj.team === 'home';
                const teamName = isHome ? home : away;
                const style = impactStyle(inj.impact);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border ${style.border} ${style.bg} px-3 py-2`}
                  >
                    <span className="shrink-0 rounded-full bg-[#00FF00]/10 px-2 py-0.5 text-[10px] font-bold text-[#00FF00]">
                      {isHome ? 'DOM' : 'EXT'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {sanitizeText(inj.player, 200)}
                      </p>
                      <p className="truncate text-[11px] text-zinc-400">
                        {teamName}
                        {inj.reason ? ` · ${sanitizeText(inj.reason, 300)}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 whitespace-nowrap text-[10px] font-bold ${style.text}`}
                    >
                      {style.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Team news */}
        {data.team_news && data.team_news.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]/80">
              Actus équipes
            </p>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {data.team_news.map((news, i) => {
                const isHome = news.team === 'home';
                const teamName = isHome ? home : away;
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-[#00FF00]/15 bg-[#141414]/40 px-3 py-2"
                  >
                    <p className="mb-0.5 text-[10px] font-bold text-[#00FF00]">
                      {teamName}
                    </p>
                    <p className="text-[12px] leading-snug text-zinc-300">
                      {sanitizeText(news.news, 500)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* H2H */}
        {data.h2h && (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]/80">
              Confrontations directes
            </p>
            <p className="text-sm leading-relaxed text-zinc-300">{sanitizeText(data.h2h)}</p>
          </div>
        )}

        {/* Score predictions from web sources */}
        {data.score_predictions && data.score_predictions.consensus && (
          <div className="rounded-lg border border-[#00FF00]/30 bg-gradient-to-r from-[#00FF00]/10 to-transparent p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]">
              <Trophy className="h-3 w-3" /> Prédiction consensus Web
            </p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-3xl font-black text-[#00FF00]" style={{ textShadow: '0 0 8px rgba(0,255,0,0.5)' }}>
                {sanitizeText(data.score_predictions.consensus, 20)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                data.score_predictions.confidence === 'high' ? 'bg-[#00FF00]/20 text-[#00FF00]' :
                data.score_predictions.confidence === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-500/20 text-zinc-400'
              }`}>
                Confiance {data.score_predictions.confidence === 'high' ? 'haute' : data.score_predictions.confidence === 'medium' ? 'moyenne' : 'faible'}
              </span>
            </div>
            {data.score_predictions.alternative_scores && data.score_predictions.alternative_scores.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">Autres scores envisagés:</span>
                {data.score_predictions.alternative_scores.map((score, i) => (
                  <span key={i} className="rounded-md border border-[#00FF00]/20 bg-[#00FF00]/8 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#00FF00]">
                    {sanitizeText(score, 10)}
                  </span>
                ))}
              </div>
            )}
            {data.score_predictions.sources_summary && (
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                {sanitizeText(data.score_predictions.sources_summary, 500)}
              </p>
            )}
          </div>
        )}

        {/* Prediction context */}
        {data.prediction_context && (
          <div className="rounded-lg border border-[#00FF00]/25 bg-gradient-to-r from-[#00FF00]/8 to-transparent p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF00]">
              <Sparkles className="h-3 w-3" />
              Contexte pronostic
            </p>
            <p className="text-[12px] leading-relaxed text-zinc-300">
              {sanitizeText(data.prediction_context, 1000)}
            </p>
          </div>
        )}

        {/* Sources */}
        {data.sources && data.sources.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Sources
              {data.source
                ? ` · ${data.source === 'sdk' ? 'SDK Z.AI' : 'DuckDuckGo'}`
                : ''}
            </p>
            <div className="space-y-1">
              {data.sources
                .slice(0, 4)
                .filter((src) => isSafeUrl(src.url))
                .map((src, i) => (
                  <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                    className="block truncate text-[11px] text-zinc-500 transition-colors hover:text-[#00FF00]"
                    title={sanitizeText(src.title, 200) || src.url}
                  >
                    → {sanitizeText(src.title, 200) || src.url}
                  </a>
                ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
