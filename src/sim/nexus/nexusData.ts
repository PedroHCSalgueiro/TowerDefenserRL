/**
 * Números do núcleo, lidos de `src/data/nexus.json`. O alcance é em casas,
 * medido do centro do núcleo até a posição do inimigo.
 */

import nexusJson from '../../data/nexus.json';

/** Um nível do núcleo. `cost` é o ouro para chegar nele (o nível 1 é o início). */
export interface NexusLevel {
  readonly cost: number;
  readonly towerLimit: number;
  readonly maxHp: number;
}

export interface NexusData {
  /** `levels[n - 1]` é o nível `n`; o último é o máximo. */
  readonly levels: readonly NexusLevel[];
  readonly attack: {
    readonly damage: number;
    readonly cooldownSeconds: number;
    readonly range: number;
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isLevel(value: unknown): value is NexusLevel {
  const level = value as Partial<NexusLevel> | null;
  return (
    typeof level === 'object' &&
    level !== null &&
    typeof level.cost === 'number' &&
    Number.isInteger(level.cost) &&
    level.cost >= 0 &&
    Number.isInteger(level.towerLimit) &&
    isPositive(level.towerLimit) &&
    Number.isInteger(level.maxHp) &&
    isPositive(level.maxHp)
  );
}

export function loadNexusData(raw: unknown): NexusData {
  const data = raw as Partial<NexusData> | null;
  const attack = data?.attack;
  if (
    !Array.isArray(data?.levels) ||
    data.levels.length === 0 ||
    !data.levels.every(isLevel) ||
    !attack ||
    !isPositive(attack.damage) ||
    !isPositive(attack.cooldownSeconds) ||
    !isPositive(attack.range)
  ) {
    throw new Error('Dados do núcleo inválidos: campos ausentes ou não positivos');
  }
  return {
    levels: data.levels.map((l) => ({ cost: l.cost, towerLimit: l.towerLimit, maxHp: l.maxHp })),
    attack: {
      damage: attack.damage,
      cooldownSeconds: attack.cooldownSeconds,
      range: attack.range,
    },
  };
}

export const nexusData: NexusData = loadNexusData(nexusJson);

/** Dados do nível `level`, preso entre o primeiro e o último da tabela. */
export function nexusLevel(data: NexusData, level: number): NexusLevel {
  return data.levels[Math.min(Math.max(1, level), data.levels.length) - 1] as NexusLevel;
}

/** Limite de torres no mapa no nível `level`. */
export function towerLimit(data: NexusData, level: number): number {
  return nexusLevel(data, level).towerLimit;
}

/** Nível máximo da tabela. */
export function maxNexusLevel(data: NexusData): number {
  return data.levels.length;
}
