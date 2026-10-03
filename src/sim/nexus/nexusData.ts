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

/**
 * Níveis depois da tabela (T22, núcleo sem teto): cada nível custa o
 * custo do anterior × `costMultiplier` (arredondado) e soma `towerLimitPerLevel`
 * ao limite de torres e `maxHpPerLevel` à vida máxima. Sem teto.
 */
export interface NexusGrowth {
  readonly costMultiplier: number;
  readonly towerLimitPerLevel: number;
  readonly maxHpPerLevel: number;
}

export interface NexusData {
  /** `levels[n - 1]` é o nível `n`. Sem `beyondLevels`, o último é o máximo. */
  readonly levels: readonly NexusLevel[];
  /** Níveis depois da tabela, sem teto (`null` = a tabela é o máximo). */
  readonly beyondLevels: NexusGrowth | null;
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
  const growth = (raw as { beyondLevels?: Partial<NexusGrowth> | null }).beyondLevels ?? null;
  if (
    growth !== null &&
    (!isPositive(growth.costMultiplier) ||
      !Number.isInteger(growth.towerLimitPerLevel) ||
      (growth.towerLimitPerLevel as number) < 0 ||
      !Number.isInteger(growth.maxHpPerLevel) ||
      (growth.maxHpPerLevel as number) < 0)
  ) {
    throw new Error('Dados do núcleo inválidos: "beyondLevels" com campos ausentes ou negativos');
  }
  return {
    levels: data.levels.map((l) => ({ cost: l.cost, towerLimit: l.towerLimit, maxHp: l.maxHp })),
    beyondLevels:
      growth === null
        ? null
        : {
            costMultiplier: growth.costMultiplier as number,
            towerLimitPerLevel: growth.towerLimitPerLevel as number,
            maxHpPerLevel: growth.maxHpPerLevel as number,
          },
    attack: {
      damage: attack.damage,
      cooldownSeconds: attack.cooldownSeconds,
      range: attack.range,
    },
  };
}

export const nexusData: NexusData = loadNexusData(nexusJson);

/**
 * Dados do nível `level` (preso em 1 e no máximo). Depois da tabela, com
 * `beyondLevels`, cada nível sai do anterior pela fórmula.
 */
export function nexusLevel(data: NexusData, level: number): NexusLevel {
  const table = data.levels;
  const wanted = Math.min(Math.max(1, Math.floor(level)), maxNexusLevel(data));
  if (wanted <= table.length) return table[wanted - 1] as NexusLevel;
  const growth = data.beyondLevels!;
  let { cost, towerLimit, maxHp } = table[table.length - 1] as NexusLevel;
  for (let n = table.length + 1; n <= wanted; n++) {
    cost = Math.round(cost * growth.costMultiplier);
    towerLimit += growth.towerLimitPerLevel;
    maxHp += growth.maxHpPerLevel;
  }
  return { cost, towerLimit, maxHp };
}

/** Limite de torres no mapa no nível `level`. */
export function towerLimit(data: NexusData, level: number): number {
  return nexusLevel(data, level).towerLimit;
}

/** Nível máximo: o último da tabela, ou `Infinity` com `beyondLevels`. */
export function maxNexusLevel(data: NexusData): number {
  return data.beyondLevels ? Infinity : data.levels.length;
}
