/**
 * Ondas da run, lidas de `src/data/waves.json`.
 *
 * Cada onda tem pulsos pequenos (um inimigo a cada `pulseSpawnSeconds`, pausa
 * de `pulsePauseSeconds` entre eles) e uma massa final (um inimigo a cada
 * `massSpawnSeconds`). A ordem dos inimigos é a dos dados, sem sorteio.
 * `hpMultiplier` multiplica a vida de todos os inimigos da onda, menos o
 * chefão (que tem valores próprios).
 */

import wavesJson from '../../data/waves.json';
import { enemyData, type EnemyData } from '../enemies/enemyData';

export interface WaveGroup {
  readonly type: string;
  readonly count: number;
}

export interface WaveDef {
  readonly hpMultiplier: number;
  readonly pulses: readonly (readonly WaveGroup[])[];
  readonly mass: readonly WaveGroup[];
}

export interface WaveTiming {
  readonly pulseSpawnSeconds: number;
  readonly pulsePauseSeconds: number;
  readonly massSpawnSeconds: number;
}

export interface WaveData {
  readonly timing: WaveTiming;
  readonly waves: readonly WaveDef[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseGroups(where: string, raw: unknown, enemies: EnemyData): WaveGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Ondas inválidas: ${where} precisa ser uma lista não vazia`);
  }
  return raw.map((group: unknown) => {
    if (!isRecord(group)) throw new Error(`Ondas inválidas: grupo de ${where} não é um objeto`);
    const { type, count } = group;
    if (typeof type !== 'string' || !Object.hasOwn(enemies.types, type)) {
      throw new Error(`Ondas inválidas: ${where} usa o inimigo desconhecido "${String(type)}"`);
    }
    if (!Number.isInteger(count) || (count as number) <= 0) {
      throw new Error(`Ondas inválidas: ${where} tem quantidade que não é inteiro positivo`);
    }
    return { type, count: count as number };
  });
}

/** Valida as ondas contra os tipos de inimigo. Erro claro em vez de onda vazia no meio da run. */
export function loadWaveData(raw: unknown, enemies: EnemyData): WaveData {
  if (!isRecord(raw) || !isRecord(raw.timing) || !Array.isArray(raw.waves)) {
    throw new Error('Ondas inválidas: faltam "timing" ou "waves"');
  }
  const { pulseSpawnSeconds, pulsePauseSeconds, massSpawnSeconds } = raw.timing;
  if (
    !isPositive(pulseSpawnSeconds) ||
    !isPositive(massSpawnSeconds) ||
    typeof pulsePauseSeconds !== 'number' ||
    !Number.isFinite(pulsePauseSeconds) ||
    pulsePauseSeconds < 0
  ) {
    throw new Error('Ondas inválidas: "timing" tem campos ausentes ou fora do intervalo');
  }
  if (raw.waves.length === 0) throw new Error('Ondas inválidas: nenhuma onda definida');
  const waves = raw.waves.map((wave: unknown, i): WaveDef => {
    const where = `a onda ${i + 1}`;
    if (!isRecord(wave) || !isPositive(wave.hpMultiplier) || !Array.isArray(wave.pulses)) {
      throw new Error(`Ondas inválidas: ${where} precisa de "hpMultiplier" e "pulses"`);
    }
    return {
      hpMultiplier: wave.hpMultiplier,
      pulses: wave.pulses.map((pulse: unknown, p) =>
        parseGroups(`o pulso ${p + 1} d${where}`, pulse, enemies),
      ),
      mass: parseGroups(`a massa d${where}`, wave.mass, enemies),
    };
  });
  return { timing: { pulseSpawnSeconds, pulsePauseSeconds, massSpawnSeconds }, waves };
}

export const waveData: WaveData = loadWaveData(wavesJson, enemyData);
