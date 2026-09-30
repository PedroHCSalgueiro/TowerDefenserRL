/**
 * Limite de torres no mapa (T12). Contam todas as torres, inclusive as de
 * debug; uma torre fundida conta como 1. O limite só barra a compra que
 * precisa de casa nova: fusão e o posicionamento cru do debug passam.
 */

import { nexusData, towerLimit, type NexusData } from '../nexus/nexusData';
import type { RunState } from '../state';

/** Torres no mapa agora. */
export function towerCount(state: Pick<RunState, 'towers'>): number {
  return state.towers.length;
}

/** Limite de torres do nível atual do núcleo. */
export function currentTowerLimit(
  state: Pick<RunState, 'nexus'>,
  nexus: NexusData = nexusData,
): number {
  return towerLimit(nexus, state.nexus.level);
}

/** Cabe mais uma torre no mapa (que não seja fusão)? */
export function hasRoomForTower(
  state: Pick<RunState, 'towers' | 'nexus'>,
  nexus: NexusData = nexusData,
): boolean {
  return towerCount(state) < currentTowerLimit(state, nexus);
}
