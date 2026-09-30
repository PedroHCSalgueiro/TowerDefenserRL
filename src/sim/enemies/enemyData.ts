/**
 * Tipos de inimigo, lidos de `src/data/enemies.json`.
 *
 * `speed` é em casas por segundo. Inimigos `ground` seguem o caminho; `air`
 * vão em linha reta da entrada até o núcleo.
 */

import enemiesJson from '../../data/enemies.json';
import type { ArmorParams } from './armor';

export type Movement = 'ground' | 'air';

export interface EnemyType {
  readonly hp: number;
  readonly speed: number;
  readonly armor: number;
  readonly nexusDamage: number;
  readonly gold: number;
  readonly movement: Movement;
  /** Chefão: imune à execução do Carrasco (que lhe dá um golpe crítico). Padrão: `false`. */
  readonly boss: boolean;
}

export interface EnemyData {
  readonly armor: ArmorParams;
  readonly types: Readonly<Record<string, EnemyType>>;
}

const MOVEMENTS: readonly string[] = ['ground', 'air'] satisfies Movement[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown, min: number, allowMin = true): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && (allowMin ? value >= min : value > min)
  );
}

function parseType(id: string, raw: unknown): EnemyType {
  if (!isRecord(raw)) {
    throw new Error(`Inimigo inválido: "${id}" não é um objeto`);
  }
  const { hp, speed, armor, nexusDamage, gold, movement } = raw;
  if (
    !isNumber(hp, 0, false) ||
    !isNumber(speed, 0, false) ||
    !isNumber(armor, 0) ||
    !isNumber(nexusDamage, 0) ||
    !isNumber(gold, 0) ||
    typeof movement !== 'string' ||
    !MOVEMENTS.includes(movement)
  ) {
    throw new Error(`Inimigo inválido: "${id}" tem campos ausentes ou fora do intervalo`);
  }
  const boss = Object.hasOwn(raw, 'boss') ? raw.boss : false;
  if (typeof boss !== 'boolean') {
    throw new Error(`Inimigo inválido: "${id}" tem "boss" que não é verdadeiro ou falso`);
  }
  return { hp, speed, armor, nexusDamage, gold, movement: movement as Movement, boss };
}

/** Valida os dados de inimigos. Erro claro em vez de NaN no meio da run. */
export function loadEnemyData(raw: unknown): EnemyData {
  if (!isRecord(raw) || !isRecord(raw.armor) || !isRecord(raw.types)) {
    throw new Error('Dados de inimigos inválidos: faltam "armor" ou "types"');
  }
  const { scale } = raw.armor;
  if (!isNumber(scale, 0, false)) {
    throw new Error('Dados de inimigos inválidos: "armor.scale" precisa ser positivo');
  }
  const entries = Object.entries(raw.types);
  if (entries.length === 0) {
    throw new Error('Dados de inimigos inválidos: nenhum tipo definido');
  }
  const types: Record<string, EnemyType> = {};
  for (const [id, type] of entries) {
    types[id] = parseType(id, type);
  }
  return { armor: { scale }, types };
}

export const enemyData: EnemyData = loadEnemyData(enemiesJson);

/** Tipo pelo id, com erro para id desconhecido (inclusive herdados, como `toString`). */
export function getEnemyType(data: EnemyData, id: string): EnemyType {
  const type = Object.hasOwn(data.types, id) ? data.types[id] : undefined;
  if (!type) {
    throw new Error(`Tipo de inimigo desconhecido: "${id}"`);
  }
  return type;
}
