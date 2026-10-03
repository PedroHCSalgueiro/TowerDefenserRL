/**
 * Modelo do painel do núcleo: nível, torres no mapa contra o limite, chances
 * de raridade atuais e do próximo nível e o custo de evoluir. Sem DOM, para
 * testar direto.
 */

import { nextLevelCost } from '../sim/nexus/evolve';
import { nexusData, towerLimit, type NexusData } from '../sim/nexus/nexusData';
import type { EconomyData } from '../sim/economy/economyData';
import { chancesFor } from '../sim/shop/shop';
import { currentTowerLimit, towerCount } from '../sim/towers/limit';
import type { RunState } from '../sim/state';
import { RARITIES, type Rarity } from '../sim/towers/towerData';

export interface NexusPanelModel {
  level: number;
  towers: number;
  towerLimit: number;
  /** Limite do próximo nível (`null` só com dados sem `beyondLevels`). */
  nextTowerLimit: number | null;
  hp: number;
  maxHp: number;
  chances: Readonly<Record<Rarity, number>>;
  /** Chances do próximo nível (`null` só com dados sem `beyondLevels`). */
  nextChances: Readonly<Record<Rarity, number>> | null;
  /** Custo de evoluir (`null` só com dados sem `beyondLevels`). */
  cost: number | null;
  canEvolve: boolean;
}

export function buildNexusPanelModel(
  state: Readonly<RunState>,
  economy: EconomyData,
  nexus: NexusData = nexusData,
): NexusPanelModel {
  const { level } = state.nexus;
  const cost = nextLevelCost(nexus, level);
  return {
    level,
    towers: towerCount(state),
    towerLimit: currentTowerLimit(state, nexus),
    nextTowerLimit: cost === null ? null : towerLimit(nexus, level + 1),
    hp: Math.ceil(state.nexus.hp),
    maxHp: state.nexus.maxHp,
    chances: chancesFor(economy, level),
    nextChances: cost === null ? null : chancesFor(economy, level + 1),
    cost,
    canEvolve: cost !== null && state.status === 'playing' && state.gold >= cost,
  };
}

/** Assinatura do modelo: a interface só mexe no DOM quando ela muda. */
export function nexusPanelKey(model: NexusPanelModel): string {
  const chances = (c: Readonly<Record<Rarity, number>> | null) =>
    c ? RARITIES.map((r) => c[r]).join('/') : '-';
  return [
    model.level,
    model.towers,
    model.towerLimit,
    model.hp,
    model.maxHp,
    chances(model.chances),
    chances(model.nextChances),
    model.cost ?? '-',
    model.canEvolve ? 1 : 0,
  ].join('|');
}
