/**
 * Efeito somado dos bônus escolhidos (T24), lido pelos sistemas: um objeto
 * com os valores já combinados (somas, multiplicadores, tetos). Fica em
 * cache por lista de escolhidos: só muda quando um bônus entra, e os
 * leitores rodam a cada tiro e a cada abate.
 *
 * Repetidos somam: +25% duas vezes = +50%; +1 de limite duas vezes = +2.
 */

import type { RewardsState, TakenReward } from './rewardState';
import { getReward, rewardData, type RewardData } from './rewardData';

export interface RewardMods {
  /** Por classe: +% de dano da área (tiro em área e explosões). */
  readonly areaDamagePercent: Readonly<Record<string, number>>;
  /** Por classe: quanto as contagens "a cada N" caem depois do bônus de classe. */
  readonly triggerCountMinus: Readonly<Record<string, number>>;
  /** Por classe: multiplicador das mortes de elite e chefão nos contadores e cargas. */
  readonly eliteKillWeight: Readonly<Record<string, number>>;
  /** Por classe: torres a mais na contagem do bônus de classe (coringa). */
  readonly wildcards: Readonly<Record<string, number>>;
  /** Trava de ativação de todas as torres (`null` = a dos dados das torres). */
  readonly activationCooldownSeconds: number | null;
  /** Teto dos juros (`null` = o da economia). */
  readonly interestCap: number | null;
  readonly incomePerWave: number;
  readonly freeRerollsPerShop: number;
  readonly towerDiscountPercent: number;
  /** Devolução da venda (`null` = a da economia). */
  readonly sellRefundPercent: number | null;
  readonly towerLimit: number;
  readonly nexusMaxHp: number;
  readonly nexusDamageMultiplier: number;
  readonly shopRarityLevels: number;
  /** Ouro das cadeias (`null` = desligado). */
  readonly chainGold: { readonly every: number; readonly gold: number } | null;
}

export const NO_REWARD_MODS: RewardMods = {
  areaDamagePercent: {},
  triggerCountMinus: {},
  eliteKillWeight: {},
  wildcards: {},
  activationCooldownSeconds: null,
  interestCap: null,
  incomePerWave: 0,
  freeRerollsPerShop: 0,
  towerDiscountPercent: 0,
  sellRefundPercent: null,
  towerLimit: 0,
  nexusMaxHp: 0,
  nexusDamageMultiplier: 1,
  shopRarityLevels: 0,
  chainGold: null,
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function add(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

/** Combina a lista de escolhidos (sem cache). */
export function combineRewards(taken: readonly TakenReward[], data: RewardData): RewardMods {
  if (taken.length === 0) return NO_REWARD_MODS;
  const mods: Mutable<RewardMods> = {
    ...NO_REWARD_MODS,
    areaDamagePercent: {},
    triggerCountMinus: {},
    eliteKillWeight: {},
    wildcards: {},
  };
  const elite = mods.eliteKillWeight as Record<string, number>;
  for (const pick of taken) {
    const reward = getReward(data, pick.id);
    const classId = reward.classId ?? '';
    const e = reward.effect;
    switch (e.kind) {
      case 'areaDamagePercent':
        add(mods.areaDamagePercent as Record<string, number>, classId, e.percent);
        break;
      case 'triggerCountMinus':
        add(mods.triggerCountMinus as Record<string, number>, classId, e.amount);
        break;
      case 'eliteKillWeight':
        elite[classId] = (elite[classId] ?? 1) * e.multiplier;
        break;
      case 'classWildcard':
        if (pick.classId !== null)
          add(mods.wildcards as Record<string, number>, pick.classId, e.count);
        break;
      case 'activationCooldownSeconds':
        mods.activationCooldownSeconds = Math.min(
          mods.activationCooldownSeconds ?? Infinity,
          e.seconds,
        );
        break;
      case 'interestCap':
        mods.interestCap = Math.max(mods.interestCap ?? 0, e.cap);
        break;
      case 'incomePerWave':
        mods.incomePerWave += e.gold;
        break;
      case 'freeRerollsPerShop':
        mods.freeRerollsPerShop += e.count;
        break;
      case 'towerDiscountPercent':
        mods.towerDiscountPercent = Math.max(mods.towerDiscountPercent, e.percent);
        break;
      case 'sellRefundPercent':
        mods.sellRefundPercent = Math.max(mods.sellRefundPercent ?? 0, e.percent);
        break;
      case 'towerLimit':
        mods.towerLimit += e.amount;
        break;
      case 'nexusMaxHp':
        mods.nexusMaxHp += e.amount;
        break;
      case 'nexusDamageMultiplier':
        mods.nexusDamageMultiplier *= e.multiplier;
        break;
      case 'shopRarityLevels':
        mods.shopRarityLevels += e.levels;
        break;
      case 'chainGold':
        mods.chainGold = { every: e.every, gold: e.gold };
        break;
    }
  }
  return mods;
}

const cache = new WeakMap<
  readonly TakenReward[],
  { count: number; data: RewardData; mods: RewardMods }
>();

/**
 * Efeito dos bônus escolhidos na run. Aceita estados sem `rewards` (testes
 * com estados parciais): sem recompensas, tudo neutro.
 */
export function rewardMods(
  state: { readonly rewards?: RewardsState },
  data: RewardData = rewardData,
): RewardMods {
  const taken = state.rewards?.taken;
  if (!taken || taken.length === 0) return NO_REWARD_MODS;
  const hit = cache.get(taken);
  if (hit && hit.count === taken.length && hit.data === data) return hit.mods;
  const mods = combineRewards(taken, data);
  cache.set(taken, { count: taken.length, data, mods });
  return mods;
}
