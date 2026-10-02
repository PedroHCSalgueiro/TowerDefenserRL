/**
 * Expande cada onda dos dados numa lista fixa de nascimentos: em que tick
 * (contado do início da onda) nasce cada inimigo. Sem RNG: a mesma onda gera
 * sempre a mesma lista, e o save só precisa guardar quantos já nasceram.
 */

import type { WaveData, WaveDef } from './waveData';

export interface SpawnEntry {
  /** Ticks desde o início da onda (0 = o tick em que ela foi chamada). */
  readonly tick: number;
  readonly type: string;
  readonly elite: boolean;
}

export interface WaveSchedule {
  readonly hpMultiplier: number;
  readonly entries: readonly SpawnEntry[];
}

/**
 * Fila única: o primeiro nasce no tick da chamada e cada um dos seguintes
 * `spawnSeconds` depois do anterior, na ordem dos grupos. Os segundos são
 * convertidos para ticks a partir da posição na fila, para o arredondamento
 * não acumular erro.
 */
export function buildWaveSchedule(wave: WaveDef, ticksPerSecond: number): WaveSchedule {
  const entries: SpawnEntry[] = [];
  for (const group of wave.enemies) {
    for (let i = 0; i < group.count; i++) {
      const seconds = entries.length * wave.spawnSeconds;
      // O epsilon evita que 0,15 × 3 = 0,44999... arredonde para baixo.
      entries.push({
        tick: Math.round(seconds * ticksPerSecond + 1e-9),
        type: group.type,
        elite: group.elite,
      });
    }
  }
  return { hpMultiplier: wave.hpMultiplier, entries };
}

export function buildWaveSchedules(data: WaveData, ticksPerSecond: number): WaveSchedule[] {
  return data.waves.map((wave) => buildWaveSchedule(wave, ticksPerSecond));
}
