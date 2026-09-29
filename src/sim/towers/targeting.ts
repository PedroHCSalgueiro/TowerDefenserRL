/**
 * Modos de mira das torres, escolhidos por dados (`targetMode` em
 * `towers.json`).
 *
 * Cada modo é só uma nota dada a cada inimigo dentro do alcance: vence a
 * menor nota, com empate para o menor id (`SpatialIndex.findBest`). Um modo
 * novo (T18) é uma nota nova aqui, sem mexer nas torres nem no índice.
 */

import type { EnemyData } from '../enemies/enemyData';
import type { Enemy } from '../enemies/pool';
import type { Routes } from '../enemies/route';

export const TARGET_MODES = ['first'] as const;

export type TargetMode = (typeof TARGET_MODES)[number];

/** Nota de um inimigo para uma torre em (`fromX`, `fromY`): menor é melhor. */
export type TargetScore = (enemy: Enemy, fromX: number, fromY: number) => number;

export type TargetScores = Readonly<Record<TargetMode, TargetScore>>;

export function isTargetMode(value: unknown): value is TargetMode {
  return (TARGET_MODES as readonly unknown[]).includes(value);
}

/**
 * Monta as notas de cada modo:
 * - `first`: o mais avançado, ou seja, o que tem a menor distância que falta
 *   até o núcleo, cada inimigo na sua própria rota (terrestre ou aérea).
 */
export function createTargetScores(routes: Routes, enemies: EnemyData): TargetScores {
  const routeLength = new Map<string, number>();
  for (const [id, type] of Object.entries(enemies.types)) {
    routeLength.set(id, routes[type.movement].length);
  }
  const remaining = (enemy: Enemy): number => {
    const length = routeLength.get(enemy.type);
    if (length === undefined) {
      throw new Error(`Tipo de inimigo desconhecido: "${enemy.type}"`);
    }
    return length - enemy.distance;
  };
  return {
    first: remaining,
  };
}
