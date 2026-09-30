/**
 * Modelo da loja e do ouro: transforma o estado da run em dados prontos para
 * mostrar. Sem DOM, para testar direto.
 */

import type { ClassData } from '../sim/classes/classData';
import { interestFor } from '../sim/economy/economy';
import type { EconomyData } from '../sim/economy/economyData';
import type { GridCoord, GridMap } from '../sim/grid/map';
import { priceOf, refundFor } from '../sim/shop/shop';
import type { RunState } from '../sim/state';
import { getTowerType, type Rarity, type TowerData } from '../sim/towers/towerData';

export const RARITY_LABELS: Readonly<Record<Rarity, string>> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Rara',
};

export interface ShopSlotModel {
  index: number;
  /** `null` = slot comprado (vazio). */
  towerType: string | null;
  name: string;
  classes: string[];
  rarity: Rarity | null;
  rarityLabel: string;
  price: number;
  /** Tem ouro para comprar (slot vazio nunca tem). */
  affordable: boolean;
}

export interface SellTargetModel {
  towerId: number;
  name: string;
  refund: number;
}

export interface ShopModel {
  gold: number;
  /** Juros que entram no fim da próxima onda, com o ouro de agora. */
  interest: number;
  /** Número da próxima onda a fechar. */
  nextWave: number;
  rerollCost: number;
  canReroll: boolean;
  slots: ShopSlotModel[];
  /** Torre da casa selecionada, se houver. */
  sell: SellTargetModel | null;
}

export function buildShopModel(
  state: Readonly<RunState>,
  selected: GridCoord | null,
  economy: EconomyData,
  towers: TowerData,
  classes: ClassData,
): ShopModel {
  const slots = state.shop.slots.map((towerType, index): ShopSlotModel => {
    if (towerType === null) {
      return {
        index,
        towerType,
        name: '',
        classes: [],
        rarity: null,
        rarityLabel: '',
        price: 0,
        affordable: false,
      };
    }
    const type = getTowerType(towers, towerType);
    const price = priceOf(economy, towers, towerType) ?? 0;
    return {
      index,
      towerType,
      name: type.name,
      classes: type.classes.map((id) => classes.classes[id]?.name ?? id),
      rarity: type.rarity,
      rarityLabel: type.rarity ? RARITY_LABELS[type.rarity] : '',
      price,
      affordable: state.gold >= price,
    };
  });
  const tower = selected
    ? state.towers.find((t) => t.x === selected.x && t.y === selected.y)
    : undefined;
  return {
    gold: state.gold,
    interest: interestFor(economy, state.gold),
    nextWave: state.wave + 1,
    rerollCost: economy.shop.rerollCost,
    canReroll: state.gold >= economy.shop.rerollCost,
    slots,
    sell: tower
      ? {
          towerId: tower.id,
          name: towers.types[tower.type]?.name ?? tower.type,
          refund: refundFor(economy, tower.invested),
        }
      : null,
  };
}

/** Assinatura do modelo: a interface só mexe no DOM quando ela muda. */
export function shopModelKey(model: ShopModel, carrySlot: number | null): string {
  const slots = model.slots.map((s) => `${s.towerType ?? '-'}:${s.affordable ? 1 : 0}`).join(',');
  const sell = model.sell ? `${model.sell.towerId}:${model.sell.refund}` : '-';
  return [
    model.gold,
    model.interest,
    model.nextWave,
    model.canReroll ? 1 : 0,
    slots,
    sell,
    carrySlot ?? '-',
  ].join('|');
}

/** Dá para posicionar uma torre nesta casa (dentro do mapa, fora do caminho e sem torre)? */
export function canPlaceAt(
  state: Readonly<RunState>,
  map: Pick<GridMap, 'canPlaceTower'>,
  cell: GridCoord,
): boolean {
  return map.canPlaceTower(cell) && !state.towers.some((t) => t.x === cell.x && t.y === cell.y);
}
