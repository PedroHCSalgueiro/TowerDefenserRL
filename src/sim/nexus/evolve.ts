/**
 * Evoluir o núcleo (T12): paga o custo do próximo nível, sobe o nível, a vida
 * máxima e cura a diferença entre as vidas máximas (5 na tabela atual, sem
 * encher a barra). As chances de raridade novas valem a partir do próximo
 * reroll ou da próxima loja; a loja atual não é sorteada de novo. A vida a
 * mais do bônus "Núcleo reforçado" (T24) continua somada no nível novo.
 */

import type { TickContext } from '../engine/simulation';
import { maxNexusLevel, nexusLevel, type NexusData } from './nexusData';
import { spendGold } from '../economy/gold';
import { rewardMods } from '../rewards/mods';

/** Custo para chegar ao próximo nível (`null` = já está no máximo). */
export function nextLevelCost(data: NexusData, level: number): number | null {
  return level >= maxNexusLevel(data) ? null : nexusLevel(data, level + 1).cost;
}

/** Não faz nada, sem cobrar, se faltar ouro, no nível máximo ou com a run perdida. */
export function evolveNexus(ctx: TickContext, data: NexusData): boolean {
  const { state } = ctx;
  if (state.status !== 'playing') return false;
  const cost = nextLevelCost(data, state.nexus.level);
  if (cost === null || state.gold < cost) return false;
  const current = nexusLevel(data, state.nexus.level);
  const next = nexusLevel(data, state.nexus.level + 1);
  spendGold(state, cost);
  const maxHp = next.maxHp + rewardMods(state).nexusMaxHp;
  state.nexus.level += 1;
  state.nexus.maxHp = maxHp;
  state.nexus.hp = Math.min(maxHp, state.nexus.hp + (next.maxHp - current.maxHp));
  ctx.emit({
    type: 'nexusEvolved',
    tick: state.tick,
    level: state.nexus.level,
    hp: state.nexus.hp,
    maxHp: state.nexus.maxHp,
    cost,
  });
  return true;
}
