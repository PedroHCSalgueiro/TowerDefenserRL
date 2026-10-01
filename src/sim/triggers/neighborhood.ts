/**
 * Vizinhança dos gatilhos, em funções puras: o motor usa no tick e a janela
 * de informações (T16) usa para destacar as vizinhas que a torre afeta, com a
 * mesma regra.
 *
 * - Sem bônus: a vizinhança dos dados (4 casas de lado ou 8 com diagonais).
 * - Com o bônus da Arcana (`radius` > 0): o quadrado de lado 2·raio+1.
 * - Com `reach` (Relé ★3): as vizinhas mais as casas em cruz até `reach`.
 */

import { neighborhoodRadius } from '../classes/bonuses';
import type { ClassData } from '../classes/classData';
import type { RunState } from '../state';
import type { Tower } from '../towers/placement';
import { clampStar } from '../towers/stars';
import { getTowerType, type TowerData } from '../towers/towerData';
import { triggerAt } from './triggerData';

type Cell = Pick<Tower, 'x' | 'y'>;

/** `b` é vizinha de `a`? `radius` > 0: quadrado da Arcana; senão, a vizinhança dos dados. */
export function isNeighbor(a: Cell, b: Cell, neighborhood: 4 | 8, radius: number): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (radius > 0) return dx + dy > 0 && Math.max(dx, dy) <= radius;
  return neighborhood === 4 ? dx + dy === 1 : Math.max(dx, dy) === 1;
}

/** Vizinha ou na cruz até `reach` casas (Relé ★3). */
export function isReachNeighbor(
  a: Cell,
  b: Cell,
  neighborhood: 4 | 8,
  radius: number,
  reach: number,
): boolean {
  if (isNeighbor(a, b, neighborhood, radius)) return true;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy > 0 && (dx === 0 || dy === 0) && dx + dy <= reach;
}

/**
 * As vizinhas que o gatilho da torre envolve, em ordem de id, com a
 * vizinhança atual (bônus da Arcana de `state.classes` e a cruz do Relé ★3):
 * as que ela ativa (ativar vizinhas, Obelisco ★3), as que ela copia e as
 * cujos abates a carregam. Torre sem gatilho de vizinhança: lista vazia.
 */
export function affectedNeighbors(
  state: Pick<RunState, 'towers' | 'classes'>,
  tower: Tower,
  towers: TowerData,
  classes: ClassData,
): Tower[] {
  const type = getTowerType(towers, tower.type);
  if (!type.trigger) return [];
  const { when, effect } = triggerAt(type.trigger, clampStar(type, tower.star));
  const usesNeighbors =
    effect.kind === 'activateNeighbors' ||
    effect.kind === 'copyLast' ||
    when.kind === 'neighborKills' ||
    (effect.kind === 'chargeLightning' && effect.activateOnDischarge);
  if (!usesNeighbors) return [];
  const radius = neighborhoodRadius(classes, state, type);
  const reach = effect.kind === 'activateNeighbors' ? effect.reach : 0;
  const { neighborhood } = towers.triggers;
  return state.towers
    .filter((t) => t !== tower && isReachNeighbor(tower, t, neighborhood, radius, reach))
    .sort((a, b) => a.id - b.id);
}
