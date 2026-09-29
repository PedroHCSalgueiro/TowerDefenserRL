/**
 * Números das ferramentas de debug da simulação, lidos de
 * `src/data/debug.json`: torre de teste e limite de spawn por ação.
 */

import debugJson from '../../data/debug.json';

export interface DummyTowerData {
  readonly damage: number;
  readonly shotsPerSecond: number;
  /** Alcance em casas, do centro da casa da torre até o inimigo. */
  readonly range: number;
  /** Casas por segundo. */
  readonly projectileSpeed: number;
}

export interface SimDebugData {
  readonly dummyTower: DummyTowerData;
  /** Teto de inimigos ou torres criados por uma única ação de debug. */
  readonly maxSpawnPerCommand: number;
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function loadSimDebugData(raw: unknown): SimDebugData {
  const data = raw as Partial<SimDebugData> | null;
  const tower = data?.dummyTower;
  if (
    !tower ||
    !isPositive(tower.damage) ||
    !isPositive(tower.shotsPerSecond) ||
    !isPositive(tower.range) ||
    !isPositive(tower.projectileSpeed) ||
    !isPositive(data.maxSpawnPerCommand) ||
    !Number.isInteger(data.maxSpawnPerCommand)
  ) {
    throw new Error('Dados de debug inválidos: campos ausentes ou não positivos');
  }
  return {
    dummyTower: {
      damage: tower.damage,
      shotsPerSecond: tower.shotsPerSecond,
      range: tower.range,
      projectileSpeed: tower.projectileSpeed,
    },
    maxSpawnPerCommand: data.maxSpawnPerCommand,
  };
}

export const simDebugData: SimDebugData = loadSimDebugData(debugJson);
