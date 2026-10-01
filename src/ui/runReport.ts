/**
 * Resumo da run para as telas de vitória e derrota e o relatório copiável
 * (T17), em texto simples, para os testadores colarem nos relatos.
 */

import type { RunState } from '../sim/state';

export interface RunSummary {
  seed: string;
  /** Hash curto do commit da build. */
  version: string;
  won: boolean;
  /** Onda alcançada (a mais nova em andamento na derrota; a última na vitória). */
  wave: number;
  totalWaves: number;
  seconds: number;
  kills: number;
  /** Maior cadeia da run, em gatilhos (`RunState.stats.longestChain`). */
  longestChain: number;
  /** Torres no mapa no fim, na ordem do mapa. */
  towers: { name: string; star: number }[];
  nexusLevel: number;
  /** Juros, bônus, bônus antecipado e ouro de abate (sem venda nem trapaça). */
  goldEarned: number;
  cheated: boolean;
  /** Link com `?seed=`: o mesmo início e as mesmas lojas. */
  link: string;
}

export interface RunSummaryContext {
  version: string;
  totalWaves: number;
  ticksPerSecond: number;
  towerName: (type: string) => string;
  link: string;
}

/** Monta o resumo a partir do estado final da run. */
export function summarizeRun(state: Readonly<RunState>, ctx: RunSummaryContext): RunSummary {
  const newest = state.waves.active[state.waves.active.length - 1]?.wave ?? state.wave;
  return {
    seed: state.seed,
    version: ctx.version,
    won: state.status === 'won',
    wave: Math.min(newest, ctx.totalWaves),
    totalWaves: ctx.totalWaves,
    seconds: state.tick / ctx.ticksPerSecond,
    kills: state.stats.kills,
    longestChain: state.stats.longestChain,
    towers: state.towers.map((t) => ({ name: ctx.towerName(t.type), star: t.star })),
    nexusLevel: state.nexus.level,
    goldEarned: state.stats.goldEarned,
    cheated: state.cheated,
    link: ctx.link,
  };
}

/** Tempo de jogo em "m:ss". */
export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** Relatório em texto simples, uma informação por linha. */
export function formatRunReport(s: RunSummary): string {
  const towers = s.towers.length
    ? s.towers.map((t) => `${t.name} ★${t.star}`).join(', ')
    : 'nenhuma';
  return [
    'Relatório da run',
    `Semente: ${s.seed}`,
    `Versão: ${s.version}`,
    `Resultado: ${s.won ? 'vitória' : 'derrota'}`,
    `Onda alcançada: ${s.wave}/${s.totalWaves}`,
    `Tempo: ${formatTime(s.seconds)}`,
    `Abates: ${s.kills}`,
    `Maior cadeia: x${s.longestChain}`,
    `Torres finais (${s.towers.length}): ${towers}`,
    `Núcleo: nível ${s.nexusLevel}`,
    `Ouro ganho: ${s.goldEarned}`,
    `Trapaça: ${s.cheated ? 'sim' : 'não'}`,
    `Link: ${s.link}`,
  ].join('\n');
}
