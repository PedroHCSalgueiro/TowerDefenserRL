/**
 * Ondas da run, lidas de `src/data/waves.json`.
 *
 * Cada onda é uma fila única e contínua: um inimigo a cada `spawnSeconds`,
 * na ordem da lista `enemies` (grupos em sequência, sem pausas e sem
 * sorteio). Um grupo com `elite: true` traz a versão elite do tipo (ver
 * `EnemyData.elite`). `hpMultiplier` multiplica a vida de todos os inimigos
 * da onda, menos os chefões (que têm valores próprios).
 */

import wavesJson from '../../data/waves.json';
import { enemyData, type EnemyData } from '../enemies/enemyData';

export interface WaveGroup {
  readonly type: string;
  readonly count: number;
  readonly elite: boolean;
}

export interface WaveDef {
  readonly hpMultiplier: number;
  /** Segundos entre um inimigo e o próximo da fila. */
  readonly spawnSeconds: number;
  readonly enemies: readonly WaveGroup[];
}

export interface WaveData {
  /**
   * Trava de segurança: com tantos inimigos ativos, os próximos esperam na
   * entrada, na ordem, e nascem quando abrir espaço (fila invisível).
   */
  readonly maxActiveEnemies: number;
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
    throw new Error(`Ondas inválidas: ${where} precisa de "enemies" com pelo menos um grupo`);
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
    const elite = Object.hasOwn(group, 'elite') ? group.elite : false;
    if (typeof elite !== 'boolean') {
      throw new Error(`Ondas inválidas: ${where} tem "elite" que não é verdadeiro ou falso`);
    }
    if (elite && enemies.types[type]!.boss) {
      throw new Error(`Ondas inválidas: ${where} marca um chefão como elite`);
    }
    return { type, count: count as number, elite };
  });
}

/** Valida as ondas contra os tipos de inimigo. Erro claro em vez de onda vazia no meio da run. */
export function loadWaveData(raw: unknown, enemies: EnemyData): WaveData {
  if (!isRecord(raw) || !Array.isArray(raw.waves)) {
    throw new Error('Ondas inválidas: falta "waves"');
  }
  if (Object.hasOwn(raw, 'timing')) {
    throw new Error('Ondas inválidas: formato antigo (pulsos e "timing"); use "spawnSeconds"');
  }
  const { maxActiveEnemies } = raw;
  if (!Number.isInteger(maxActiveEnemies) || (maxActiveEnemies as number) < 1) {
    throw new Error('Ondas inválidas: "maxActiveEnemies" precisa ser inteiro >= 1');
  }
  if (raw.waves.length === 0) throw new Error('Ondas inválidas: nenhuma onda definida');
  const waves = raw.waves.map((wave: unknown, i): WaveDef => {
    const where = `a onda ${i + 1}`;
    if (!isRecord(wave) || !isPositive(wave.hpMultiplier) || !isPositive(wave.spawnSeconds)) {
      throw new Error(`Ondas inválidas: ${where} precisa de "hpMultiplier" e "spawnSeconds"`);
    }
    if (Object.hasOwn(wave, 'pulses')) {
      throw new Error(`Ondas inválidas: ${where} usa pulsos (formato antigo)`);
    }
    return {
      hpMultiplier: wave.hpMultiplier,
      spawnSeconds: wave.spawnSeconds,
      enemies: parseGroups(where, wave.enemies, enemies),
    };
  });
  return { maxActiveEnemies: maxActiveEnemies as number, waves };
}

export const waveData: WaveData = loadWaveData(wavesJson, enemyData);
