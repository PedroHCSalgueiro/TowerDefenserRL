/**
 * Expande cada onda dos dados numa lista fixa de nascimentos: em que tick
 * (contado do início da onda) nasce cada inimigo. Sem RNG: a mesma onda gera
 * sempre a mesma lista, e o save só precisa guardar quantos já nasceram.
 */

import type { WaveData, WaveDef, WaveGroup, WaveTiming } from './waveData';

export interface SpawnEntry {
  /** Ticks desde o início da onda (0 = o tick em que ela foi chamada). */
  readonly tick: number;
  readonly type: string;
}

export interface WaveSchedule {
  readonly hpMultiplier: number;
  readonly entries: readonly SpawnEntry[];
}

function expand(groups: readonly WaveGroup[]): string[] {
  return groups.flatMap((group) => Array<string>(group.count).fill(group.type));
}

/**
 * Pulsos em sequência, um inimigo a cada `pulseSpawnSeconds`; entre o último
 * de um pulso e o primeiro do próximo (e antes da massa), `pulsePauseSeconds`;
 * na massa, um a cada `massSpawnSeconds`. Os segundos são acumulados e só
 * convertidos para ticks no fim, para o arredondamento não acumular erro.
 */
export function buildWaveSchedule(
  wave: WaveDef,
  timing: WaveTiming,
  ticksPerSecond: number,
): WaveSchedule {
  const entries: SpawnEntry[] = [];
  let seconds = 0;
  const parts = [
    ...wave.pulses.map((pulse) => ({ types: expand(pulse), step: timing.pulseSpawnSeconds })),
    { types: expand(wave.mass), step: timing.massSpawnSeconds },
  ];
  parts.forEach((part, p) => {
    if (p > 0) seconds += timing.pulsePauseSeconds;
    part.types.forEach((type, i) => {
      if (i > 0) seconds += part.step;
      // O epsilon evita que 0,15 × 3 = 0,44999... arredonde para baixo.
      entries.push({ tick: Math.round(seconds * ticksPerSecond + 1e-9), type });
    });
  });
  return { hpMultiplier: wave.hpMultiplier, entries };
}

export function buildWaveSchedules(data: WaveData, ticksPerSecond: number): WaveSchedule[] {
  return data.waves.map((wave) => buildWaveSchedule(wave, data.timing, ticksPerSecond));
}
