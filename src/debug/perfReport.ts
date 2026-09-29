/**
 * Relatório de uma gravação de desempenho, em texto para copiar e colar.
 * As gravações da sessão ficam guardadas aqui e sobrevivem ao reinício da cena.
 */

import type { GateResult, PerfSummary } from './metrics';

export interface PerfReportMeta {
  speed: number;
  /** Cenário do estresse, ou `null` se gravado fora dele. */
  layout: string | null;
  stressCount: number | null;
  towers: number;
  /** Nomes dos tipos de torre no mapa (ex.: "Morteiro+Relé+Obelisco+Ceifador"). */
  towerTypes: string;
  seed: string;
  date: string;
  userAgent: string;
  viewport: string;
  devicePixelRatio: number;
  renderer: string;
}

export interface PerfReport {
  meta: PerfReportMeta;
  summary: PerfSummary;
  gate: GateResult;
  expectedTicksPerSecond: number;
  avgEnemies: number;
  avgProjectiles: number;
}

const LAYOUT_NAMES: Readonly<Record<string, string>> = {
  spread: 'espalhado',
  clustered: 'agrupado',
};

const ms = (value: number): string => `${value.toFixed(2)} ms`;

export function reportTitle(report: PerfReport): string {
  const { meta } = report;
  const scenario = meta.layout ? (LAYOUT_NAMES[meta.layout] ?? meta.layout) : 'sem estresse';
  const enemies = meta.stressCount ?? Math.round(report.avgEnemies);
  return `${meta.speed}x · ${scenario} · ${enemies} inimigos · ${meta.towers} torres (${meta.towerTypes})`;
}

export function formatReport(report: PerfReport): string {
  const { meta, summary: s, gate } = report;
  const verdict = gate.pass ? 'PASSOU' : `REPROVOU (${gate.failures.join('; ')})`;
  const t = s.triggers;
  return [
    `Desempenho — ${reportTitle(report)} — ${verdict}`,
    `FPS médio ${s.avgFps.toFixed(1)} | piores 1% ${s.lowFps.toFixed(1)} | ${s.frames} quadros em ${s.seconds.toFixed(1)} s`,
    `Tick: média ${ms(s.tick.avg)} | máx ${ms(s.tick.max)} | ${s.ticksPerSecond.toFixed(1)} ticks/s (esperado ${report.expectedTicksPerSecond}) | descartados ${s.droppedTicks}`,
    `Render (Phaser): média ${ms(s.render.avg)} | máx ${ms(s.render.max)}`,
    `Views: média ${ms(s.views.avg)} | máx ${ms(s.views.max)}`,
    `Quadro: média ${ms(s.frame.avg)} | pior ${ms(s.frame.max)}`,
    `Inimigos ativos (média) ${report.avgEnemies.toFixed(0)} | projéteis (média) ${report.avgProjectiles.toFixed(0)}`,
    `Gatilhos: ${t.avgFired.toFixed(1)}/tick (pior ${t.maxFired}) | prof. máx ${t.maxDepth} | adiados: ${t.deferredTicks} ticks (fila máx ${t.maxDeferred}) | descartados ${t.dropped}`,
    `Semente ${meta.seed} | ${meta.renderer} | tela ${meta.viewport} @${meta.devicePixelRatio}x | ${meta.date}`,
    `Navegador: ${meta.userAgent}`,
  ].join('\n');
}

const reports: PerfReport[] = [];

export function addReport(report: PerfReport): void {
  reports.push(report);
}

export function allReports(): readonly PerfReport[] {
  return reports;
}

export function clearReports(): void {
  reports.length = 0;
}
