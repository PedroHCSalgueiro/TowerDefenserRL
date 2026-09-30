/**
 * Loja: 5 slots sorteados com reposição pelo RNG da simulação, compra,
 * reroll e venda. Só torres com raridade entram (Básica e Canhão ficam de
 * fora). Slot comprado fica `null` até o próximo reroll ou loja nova.
 */

import type { EconomyData } from '../economy/economyData';
import type { TickContext } from '../engine/simulation';
import type { Rng } from '../engine/rng';
import type { GridMap } from '../grid/map';
import { placeTower } from '../towers/placement';
import {
  RARITIES,
  getTowerType,
  hasTowerType,
  type Rarity,
  type TowerData,
} from '../towers/towerData';

export interface ShopState {
  /** Id da torre em cada slot; `null` = comprado. */
  slots: (string | null)[];
}

/** Ids das torres de loja de cada raridade, na ordem dos dados. */
export function shopPools(towers: TowerData): Record<Rarity, string[]> {
  const pools: Record<Rarity, string[]> = { common: [], uncommon: [], rare: [] };
  for (const [id, type] of Object.entries(towers.types)) {
    if (type.rarity !== null) pools[type.rarity].push(id);
  }
  return pools;
}

/** Chances (em %) do nível do núcleo, preso ao último da tabela. */
export function chancesFor(economy: EconomyData, nexusLevel: number) {
  const table = economy.shop.rarityChances;
  return table[Math.min(Math.max(1, nexusLevel), table.length) - 1] as Readonly<
    Record<Rarity, number>
  >;
}

/** Preço da torre (`null` = não é de loja). */
export function priceOf(economy: EconomyData, towers: TowerData, towerType: string): number | null {
  if (!hasTowerType(towers, towerType)) return null;
  const { rarity } = getTowerType(towers, towerType);
  return rarity === null ? null : economy.shop.prices[rarity];
}

function drawRarity(rng: Rng, chances: Readonly<Record<Rarity, number>>): Rarity {
  let roll = rng.nextFloat() * 100;
  for (const rarity of RARITIES) {
    roll -= chances[rarity];
    if (roll < 0) return rarity;
  }
  return RARITIES[RARITIES.length - 1] as Rarity;
}

/**
 * Loja nova: por slot, a raridade sai da tabela do nível e depois uma torre
 * da raridade com chance igual. Na primeira loja da run, se nenhum slot
 * trouxer a raridade garantida, um slot sorteado vira uma torre dela.
 */
export function newShop(
  rng: Rng,
  economy: EconomyData,
  towers: TowerData,
  nexusLevel: number,
  isFirstShop: boolean,
): ShopState {
  const pools = shopPools(towers);
  const chances = chancesFor(economy, nexusLevel);
  const slots: string[] = [];
  for (let i = 0; i < economy.shop.slots; i++) {
    const pool = pools[drawRarity(rng, chances)];
    if (pool.length === 0) throw new Error('Loja: raridade sorteada sem nenhuma torre nos dados');
    slots.push(rng.pick(pool));
  }
  if (isFirstShop) {
    const guaranteed = economy.shop.firstShopGuarantee;
    const has = slots.some((id) => getTowerType(towers, id).rarity === guaranteed);
    if (!has) {
      const pool = pools[guaranteed];
      if (pool.length === 0)
        throw new Error('Loja: raridade garantida sem nenhuma torre nos dados');
      slots[rng.nextInt(0, slots.length - 1)] = rng.pick(pool);
    }
  }
  return { slots };
}

/**
 * Compra o slot e posiciona a torre na casa. Nada muda (nem ouro, nem slot)
 * se o slot estiver vazio, faltar ouro ou a casa for inválida ou ocupada.
 */
export function buyTower(
  ctx: TickContext,
  map: GridMap,
  towers: TowerData,
  economy: EconomyData,
  slot: number,
  cell: { x: number; y: number },
): boolean {
  const { state } = ctx;
  const towerType = Number.isInteger(slot) ? state.shop.slots[slot] : undefined;
  if (typeof towerType !== 'string') return false;
  const price = priceOf(economy, towers, towerType);
  if (price === null || state.gold < price) return false;
  const tower = placeTower(ctx, map, towers, towerType, cell);
  if (!tower) return false;
  tower.invested = price;
  state.gold -= price;
  state.shop.slots[slot] = null;
  ctx.emit({
    type: 'towerBought',
    tick: state.tick,
    towerId: tower.id,
    towerType,
    slot,
    price,
  });
  ctx.emit({ type: 'shopChanged', tick: state.tick, reason: 'bought' });
  return true;
}

/** Troca os 5 slots por sorteio novo, pagando o reroll. */
export function rerollShop(ctx: TickContext, towers: TowerData, economy: EconomyData): boolean {
  const { state } = ctx;
  if (state.gold < economy.shop.rerollCost) return false;
  state.gold -= economy.shop.rerollCost;
  state.shop = newShop(ctx.rng, economy, towers, state.nexus.level, false);
  ctx.emit({ type: 'shopChanged', tick: state.tick, reason: 'reroll' });
  return true;
}

/** Devolução da venda: a porcentagem do valor investido, arredondada para baixo. */
export function refundFor(economy: EconomyData, invested: number): number {
  return Math.floor((invested * economy.shop.sellRefundPercent) / 100);
}

/** Vende a torre: sai do mapa e devolve parte do valor investido. */
export function sellTower(ctx: TickContext, economy: EconomyData, towerId: number): boolean {
  const { state } = ctx;
  const index = state.towers.findIndex((t) => t.id === towerId);
  if (index < 0) return false;
  const [tower] = state.towers.splice(index, 1);
  if (!tower) return false;
  const refund = refundFor(economy, tower.invested);
  state.gold += refund;
  ctx.emit({
    type: 'towerSold',
    tick: state.tick,
    towerId,
    towerType: tower.type,
    x: tower.x,
    y: tower.y,
    refund,
  });
  return true;
}
