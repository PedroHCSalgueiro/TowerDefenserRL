/**
 * Fusão de torres (T11). Só acontece na compra: comprar uma cópia de um tipo
 * que já tem uma ★1 no mapa funde na hora, sem posicionar. Se já existir uma
 * ★2 do mesmo tipo, as duas viram ★3 no mesmo ato (cascata). O limite é a
 * última estrela do tipo (★3 no protótipo).
 *
 * `planFusion` só lê o estado e é usada tanto pela compra quanto pelo aviso
 * do slot da loja, para o aviso sempre bater com o resultado real.
 */

import type { TickContext } from '../engine/simulation';
import { maxStars, towerStar } from './stars';
import type { Tower } from './placement';
import { getTowerType, hasTowerType, type TowerData } from './towerData';

export interface FusionPlan {
  /** Torre que fica no mapa (mantém id, casa e estado). */
  survivorId: number;
  /** Torres que saem do mapa (a cópia comprada não tem id e não entra aqui). */
  absorbedIds: number[];
  /** Estrela da sobrevivente depois da compra. */
  star: number;
  /** Uma entrada por fusão (a cascata tem duas), na ordem em que acontecem. */
  steps: { towerId: number; stars: number; absorbedIds: number[] }[];
}

function lowestId(towers: readonly Tower[], type: string, star: number): Tower | null {
  let best: Tower | null = null;
  for (const t of towers) {
    if (t.type === type && t.star === star && (best === null || t.id < best.id)) best = t;
  }
  return best;
}

/**
 * Plano da compra de uma cópia ★1 de `towerType`, ou `null` se ela não funde
 * (sem ★1 do tipo no mapa, ou tipo com uma estrela só). Com várias
 * candidatas da mesma estrela (só por debug), vale a de menor id.
 */
export function planFusion(
  towers: readonly Tower[],
  data: TowerData,
  towerType: string,
): FusionPlan | null {
  if (!hasTowerType(data, towerType)) return null;
  const max = maxStars(getTowerType(data, towerType));
  if (max < 2) return null;
  const one = lowestId(towers, towerType, 1);
  if (!one) return null;
  const two = max >= 3 ? lowestId(towers, towerType, 2) : null;
  if (!two) {
    return {
      survivorId: one.id,
      absorbedIds: [],
      star: 2,
      steps: [{ towerId: one.id, stars: 2, absorbedIds: [] }],
    };
  }
  // Cascata: a ★1 vira ★2 e encontra a ★2; fica a ★2 original, na casa dela.
  return {
    survivorId: two.id,
    absorbedIds: [one.id],
    star: 3,
    steps: [
      { towerId: one.id, stars: 2, absorbedIds: [] },
      { towerId: two.id, stars: 3, absorbedIds: [one.id] },
    ],
  };
}

/** Estrela que a compra do tipo daria ao fundir (`null` = não funde). */
export function fusionStar(
  towers: readonly Tower[],
  data: TowerData,
  towerType: string,
): number | null {
  return planFusion(towers, data, towerType)?.star ?? null;
}

/**
 * Executa o plano: a sobrevivente sobe de estrela e soma o `invested` das
 * cópias (mais `paid`, o preço da cópia comprada); as absorvidas saem do mapa.
 * Devolve a sobrevivente. Emite um `towersMerged` por fusão.
 */
export function applyFusion(
  ctx: TickContext,
  data: TowerData,
  plan: FusionPlan,
  paid: number,
): Tower {
  const { state } = ctx;
  const survivor = state.towers.find((t) => t.id === plan.survivorId)!;
  for (const id of plan.absorbedIds) {
    const gone = state.towers.find((t) => t.id === id)!;
    survivor.invested += gone.invested;
  }
  survivor.invested += paid;
  if (plan.absorbedIds.length > 0) {
    state.towers = state.towers.filter((t) => !plan.absorbedIds.includes(t.id));
  }
  survivor.star = plan.star;
  // As cargas do raio em cadeia ficam limitadas ao teto da nova estrela.
  const effect = towerStar(getTowerType(data, survivor.type), survivor)?.effect;
  if (effect?.kind === 'chargeLightning') {
    survivor.charges = Math.min(survivor.charges, effect.charges);
  }
  for (const step of plan.steps) {
    const home = state.towers.find((t) => t.id === step.towerId) ?? survivor;
    ctx.emit({
      type: 'towersMerged',
      tick: state.tick,
      towerId: step.towerId,
      towerType: survivor.type,
      stars: step.stars,
      x: home.x,
      y: home.y,
      absorbedIds: step.absorbedIds,
    });
  }
  return survivor;
}
