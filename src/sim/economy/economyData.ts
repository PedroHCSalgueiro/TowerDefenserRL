/**
 * Economia da run e regras da loja, lidas de `src/data/economy.json`.
 * Chances em porcentagem (cada nível soma 100); `rarityChances[n - 1]` é o
 * nível `n` do núcleo.
 */

import economyJson from '../../data/economy.json';
import { RARITIES, type Rarity } from '../towers/towerData';

export interface EconomyData {
  readonly startingGold: number;
  readonly nexusStartLevel: number;
  readonly interest: { readonly percent: number; readonly cap: number };
  readonly waveBonus: { readonly base: number; readonly perWave: number };
  /**
   * Chamada antecipada: `perActiveWave` × ondas já ativas (chamadas e não
   * fechadas) no momento da chamada, pago quando a onda chamada fecha.
   */
  readonly earlyCall: { readonly perActiveWave: number };
  readonly shop: {
    readonly slots: number;
    readonly rerollCost: number;
    readonly sellRefundPercent: number;
    /** Raridade que a primeira loja da run precisa ter em pelo menos um slot. */
    readonly firstShopGuarantee: Rarity;
    readonly prices: Readonly<Record<Rarity, number>>;
    readonly rarityChances: readonly Readonly<Record<Rarity, number>>[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function fail(message: string): never {
  throw new Error(`Dados de economia inválidos: ${message}`);
}

function parseByRarity(name: string, raw: unknown, valid: (v: unknown) => boolean) {
  if (!isRecord(raw) || !RARITIES.every((r) => valid(raw[r]))) {
    fail(`"${name}" precisa ter ${RARITIES.join(', ')} válidos`);
  }
  return raw as Record<Rarity, number>;
}

export function loadEconomyData(raw: unknown): EconomyData {
  if (!isRecord(raw)) fail('não é um objeto');
  const { startingGold, nexusStartLevel, interest, waveBonus, earlyCall, shop } = raw;
  if (!isInt(startingGold, 0)) fail('"startingGold" precisa ser inteiro >= 0');
  if (!isInt(nexusStartLevel, 1)) fail('"nexusStartLevel" precisa ser inteiro >= 1');
  if (!isRecord(interest) || !isInt(interest.percent, 0) || !isInt(interest.cap, 0)) {
    fail('"interest" precisa de percent e cap inteiros >= 0');
  }
  if (!isRecord(waveBonus) || !isInt(waveBonus.base, 0) || !isInt(waveBonus.perWave, 0)) {
    fail('"waveBonus" precisa de base e perWave inteiros >= 0');
  }
  if (!isRecord(earlyCall) || !isInt(earlyCall.perActiveWave, 0)) {
    fail('"earlyCall" precisa de perActiveWave inteiro >= 0');
  }
  if (
    !isRecord(shop) ||
    !isInt(shop.slots, 1) ||
    !isInt(shop.rerollCost, 0) ||
    !isInt(shop.sellRefundPercent, 0) ||
    shop.sellRefundPercent > 100 ||
    !RARITIES.includes(shop.firstShopGuarantee as Rarity)
  ) {
    fail('"shop" com campos ausentes ou fora do intervalo');
  }
  const prices = parseByRarity('shop.prices', shop.prices, (v) => isInt(v, 1));
  if (!Array.isArray(shop.rarityChances) || shop.rarityChances.length === 0) {
    fail('"shop.rarityChances" precisa de pelo menos um nível');
  }
  const rarityChances = (shop.rarityChances as unknown[]).map((level, i) => {
    const chances = parseByRarity(`shop.rarityChances[${i}]`, level, (v) => isInt(v, 0));
    if (RARITIES.reduce((sum, r) => sum + chances[r], 0) !== 100) {
      fail(`"shop.rarityChances[${i}]" precisa somar 100`);
    }
    return chances;
  });
  if (nexusStartLevel > rarityChances.length) {
    fail('"nexusStartLevel" passa do último nível da tabela de chances');
  }
  return {
    startingGold,
    nexusStartLevel,
    interest: { percent: interest.percent, cap: interest.cap },
    waveBonus: { base: waveBonus.base, perWave: waveBonus.perWave },
    earlyCall: { perActiveWave: earlyCall.perActiveWave },
    shop: {
      slots: shop.slots,
      rerollCost: shop.rerollCost,
      sellRefundPercent: shop.sellRefundPercent,
      firstShopGuarantee: shop.firstShopGuarantee as Rarity,
      prices,
      rarityChances,
    },
  };
}

export const economyData: EconomyData = loadEconomyData(economyJson);
