/**
 * Limite de torres no mapa (T12). Contam todas as torres, inclusive as de
 * debug; uma torre fundida conta como 1. O limite só barra a compra que
 * precisa de casa nova: fusão e o posicionamento cru do debug passam.
 * O bônus "Mais espaço" das recompensas (T24) soma ao limite do nível.
 */

import { nexusData, towerLimit, type NexusData } from '../nexus/nexusData';
import { rewardMods } from '../rewards/mods';
import type { RewardsState } from '../rewards/rewardState';
import type { RunState } from '../state';

/** O que o limite lê do estado (estados sem `rewards`, de teste, valem sem recompensas). */
type LimitState = Pick<RunState, 'nexus'> & { readonly rewards?: RewardsState };

/** Torres no mapa agora. */
export function towerCount(state: Pick<RunState, 'towers'>): number {
  return state.towers.length;
}

/** Limite de torres do nível atual do núcleo. */
export function currentTowerLimit(state: LimitState, nexus: NexusData = nexusData): number {
  return towerLimit(nexus, state.nexus.level) + rewardMods(state).towerLimit;
}

/** Cabe mais uma torre no mapa (que não seja fusão)? */
export function hasRoomForTower(
  state: LimitState & Pick<RunState, 'towers'>,
  nexus: NexusData = nexusData,
): boolean {
  return towerCount(state) < currentTowerLimit(state, nexus);
}
