/**
 * Modelo da loja e do ouro: transforma o estado da run em dados prontos para
 * mostrar. Sem DOM, para testar direto.
 */

import { towerSummary } from './towerInfo';
import type { ClassData } from '../sim/classes/classData';
import { interestCapFor, interestFor } from '../sim/economy/economy';
import type { EconomyData } from '../sim/economy/economyData';
import type { GridCoord, GridMap } from '../sim/grid/map';
import { nexusData, type NexusData } from '../sim/nexus/nexusData';
import { refundFor, sellRefundPercent, shopPrice, shopRerollCost } from '../sim/shop/shop';
import { hasRoomForTower } from '../sim/towers/limit';
import { fusionStar } from '../sim/towers/fusion';
import type { RunState } from '../sim/state';
import { getTowerType, type Rarity, type TowerData } from '../sim/towers/towerData';
import { waveData } from '../sim/waves/waveData';

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
  /** Frase simples da torre (T23); vazio no slot comprado. */
  summary: string;
  classes: string[];
  rarity: Rarity | null;
  rarityLabel: string;
  price: number;
  /** Tem ouro para comprar (slot vazio nunca tem). */
  affordable: boolean;
  /** Estrela que a compra daria ao fundir com uma torre do mapa (`null` = não funde). */
  fuseStar: number | null;
  /** A compra precisaria de casa nova e o mapa está no limite do núcleo (aviso "limite"). */
  blockedByLimit: boolean;
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
  /** Custo do próximo reroll (0 = grátis, bônus das recompensas). */
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
  nexus: NexusData = nexusData,
): ShopModel {
  const roomForTower = hasRoomForTower(state, nexus);
  const slots = state.shop.slots.map((towerType, index): ShopSlotModel => {
    if (towerType === null) {
      return {
        index,
        towerType,
        name: '',
        summary: '',
        classes: [],
        rarity: null,
        rarityLabel: '',
        price: 0,
        affordable: false,
        fuseStar: null,
        blockedByLimit: false,
      };
    }
    const type = getTowerType(towers, towerType);
    const price = shopPrice(economy, towers, state, towerType) ?? 0;
    const fuseStar = fusionStar(state.towers, towers, towerType);
    return {
      index,
      towerType,
      name: type.name,
      summary: towerSummary(towerType) ?? '',
      classes: type.classes.map((id) => classes.classes[id]?.name ?? id),
      rarity: type.rarity,
      rarityLabel: type.rarity ? RARITY_LABELS[type.rarity] : '',
      price,
      affordable: state.gold >= price,
      fuseStar,
      blockedByLimit: fuseStar === null && !roomForTower,
    };
  });
  const tower = selected
    ? state.towers.find((t) => t.x === selected.x && t.y === selected.y)
    : undefined;
  const rerollCost = shopRerollCost(economy, state);
  return {
    gold: state.gold,
    interest: interestFor(economy, state.gold, interestCapFor(economy, state)),
    // Depois da última onda, o rótulo fica na última.
    nextWave: Math.min(state.wave + 1, waveData.waves.length),
    rerollCost,
    canReroll: state.gold >= rerollCost,
    slots,
    sell: tower
      ? {
          towerId: tower.id,
          name: towers.types[tower.type]?.name ?? tower.type,
          refund: refundFor(economy, tower.invested, sellRefundPercent(economy, state)),
        }
      : null,
  };
}

/** Assinatura do modelo: a interface só mexe no DOM quando ela muda. */
export function shopModelKey(model: ShopModel, carrySlot: number | null): string {
  const slots = model.slots
    .map(
      (s) =>
        `${s.towerType ?? '-'}:${s.price}:${s.affordable ? 1 : 0}:${s.fuseStar ?? 0}:${s.blockedByLimit ? 1 : 0}`,
    )
    .join(',');
  const sell = model.sell ? `${model.sell.towerId}:${model.sell.refund}` : '-';
  return [
    model.gold,
    model.interest,
    model.nextWave,
    model.rerollCost,
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
