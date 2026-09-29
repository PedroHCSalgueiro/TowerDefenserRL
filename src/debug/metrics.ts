/**
 * Cálculos das medições de desempenho (funções puras, testadas no Vitest).
 */

export interface PerfSamples {
  /** Intervalo entre quadros, em ms. */
  frameMs: readonly number[];
  /** Duração de cada tick da simulação, em ms. */
  tickMs: readonly number[];
  /** Envio do quadro pelo Phaser (pré-render → pós-render), em ms. */
  renderMs: readonly number[];
  /** Atualização da cena sem os ticks (views, painel), em ms por quadro. */
  viewsMs: readonly number[];
}

export interface Stat {
  avg: number;
  max: number;
}

export interface PerfSummary {
  seconds: number;
  frames: number;
  avgFps: number;
  /** FPS equivalente à média dos piores quadros (fração `worstFraction`). */
  lowFps: number;
  frame: Stat;
  tick: Stat;
  ticksPerSecond: number;
  render: Stat;
  views: Stat;
  droppedTicks: number;
}

export interface PerfGate {
  minAvgFps: number;
  minLowFps: number;
  maxAvgTickMs: number;
  maxDroppedTicks: number;
}

export interface GateResult {
  pass: boolean;
  failures: string[];
}

const MS_PER_SECOND = 1000;

export function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { avg: 0, max: 0 };
  let sum = 0;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return { avg: sum / values.length, max };
}

/**
 * FPS dos piores quadros: média dos `fraction` quadros mais longos (pelo
 * menos 1), convertida em FPS. Com `fraction = 0.01` é o "piores 1%".
 */
export function worstFps(frameMs: readonly number[], fraction: number): number {
  if (frameMs.length === 0) return 0;
  const count = Math.max(1, Math.ceil(frameMs.length * fraction));
  const worst = [...frameMs].sort((a, b) => b - a).slice(0, count);
  const avg = stat(worst).avg;
  return avg > 0 ? MS_PER_SECOND / avg : 0;
}

export function summarize(
  samples: PerfSamples,
  droppedTicks: number,
  worstFraction: number,
): PerfSummary {
  const frame = stat(samples.frameMs);
  const totalMs = frame.avg * samples.frameMs.length;
  const seconds = totalMs / MS_PER_SECOND;
  return {
    seconds,
    frames: samples.frameMs.length,
    avgFps: frame.avg > 0 ? MS_PER_SECOND / frame.avg : 0,
    lowFps: worstFps(samples.frameMs, worstFraction),
    frame,
    tick: stat(samples.tickMs),
    ticksPerSecond: seconds > 0 ? samples.tickMs.length / seconds : 0,
    render: stat(samples.renderMs),
    views: stat(samples.viewsMs),
    droppedTicks,
  };
}

/** Confere o resumo contra o critério do portão da T05. */
export function evaluateGate(summary: PerfSummary, gate: PerfGate): GateResult {
  const failures: string[] = [];
  if (summary.avgFps < gate.minAvgFps) {
    failures.push(`FPS médio ${summary.avgFps.toFixed(1)} < ${gate.minAvgFps}`);
  }
  if (summary.lowFps < gate.minLowFps) {
    failures.push(`piores 1% ${summary.lowFps.toFixed(1)} < ${gate.minLowFps}`);
  }
  if (summary.tick.avg > gate.maxAvgTickMs) {
    failures.push(`tick médio ${summary.tick.avg.toFixed(2)} ms > ${gate.maxAvgTickMs} ms`);
  }
  if (summary.droppedTicks > gate.maxDroppedTicks) {
    failures.push(`${summary.droppedTicks} ticks descartados`);
  }
  return { pass: failures.length === 0, failures };
}
