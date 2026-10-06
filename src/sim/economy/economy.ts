/**
 * Regras do ouro: juros e renda de fim de onda, ouro por abate e o
 * fechamento da onda. Sem estado próprio; tudo vive em `RunState`.
 */

import type { EnemyData } from '../enemies/enemyData';
import { getEnemyType } from '../enemies/enemyData';
import { runsWhileFrozen, type System, type TickContext } from '../engine/simulation';
import { rewardMods } from '../rewards/mods';
import { newShop, shopRarityLevel } from '../shop/shop';
import type { RunState } from '../state';
import type { TowerData } from '../towers/towerData';
import type { EconomyData } from './economyData';
import { earnGold } from './gold';

/** Juros sobre o ouro guardado: porcentagem arredondada para baixo, com teto. */
export function interestFor(
  economy: EconomyData,
  gold: number,
  cap = economy.interest.cap,
): number {
  const { percent } = economy.interest;
  return Math.min(cap, Math.floor((Math.max(0, gold) * percent) / 100));
}

/** Teto dos juros na run: o da economia ou o do bônus "Cofre maior" (T24). */
export function interestCapFor(economy: EconomyData, state: Pick<RunState, 'rewards'>): number {
  return rewardMods(state).interestCap ?? economy.interest.cap;
}

/**
 * Renda de fim da onda `wave` (a primeira onda é a 1): `base + perWave × wave`,
 * mais a "Renda extra" das recompensas (`extra`).
 */
export function waveBonusFor(economy: EconomyData, wave: number, extra = 0): number {
  return economy.waveBonus.base + economy.waveBonus.perWave * wave + extra;
}

/**
 * Bônus da chamada antecipada: fixo por onda já ativa (chamada e não fechada)
 * no momento da chamada. Sem onda ativa não é antecipada (0).
 */
export function earlyBonusFor(economy: EconomyData, activeWaves: number): number {
  return economy.earlyCall.perActiveWave * Math.max(0, activeWaves);
}

/**
 * Fecha uma onda: juros primeiro, sobre o ouro guardado; depois a renda; o
 * bônus da chamada antecipada daquela onda, se houver; e a loja nova grátis.
 * É o que o fim de cada onda real e o "Encerrar onda" do debug chamam. Os
 * bônus das recompensas (T24) entram no teto dos juros, na renda, na
 * raridade e nos rerolls grátis da loja nova; a tela de recompensa sai do
 * `waveEnded` (`createRewardOpenSystem`).
 */
export function endWave(
  ctx: TickContext,
  economy: EconomyData,
  towers: TowerData,
  earlyBonus = 0,
): void {
  const { state } = ctx;
  state.wave++;
  const mods = rewardMods(state);
  const interest = interestFor(economy, state.gold, interestCapFor(economy, state));
  earnGold(state, interest);
  const bonus = waveBonusFor(economy, state.wave, mods.incomePerWave);
  earnGold(state, bonus);
  earnGold(state, earlyBonus);
  state.shop = newShop(
    ctx.rng,
    economy,
    towers,
    shopRarityLevel(state),
    false,
    mods.freeRerollsPerShop,
  );
  ctx.emit({
    type: 'waveEnded',
    tick: state.tick,
    wave: state.wave,
    interest,
    bonus,
    earlyBonus,
    gold: state.gold,
  });
  ctx.emit({ type: 'shopChanged', tick: state.tick, reason: 'newWave' });
}

/**
 * Sistema de ouro, depois dos gatilhos: soma o `gold` de cada inimigo morto
 * no tick (por qualquer autor, inclusive o núcleo). Desde a T19 todo inimigo
 * tem `gold` 0 nos dados; a soma fica para dar para voltar atrás só nos dados.
 * Emite `goldChanged` uma vez por tick com o saldo final, nunca um por abate.
 */
export function createGoldSystem(enemies: EnemyData): System {
  // Roda também congelado (T24): o reroll das cartas gasta ouro.
  return runsWhileFrozen((ctx: TickContext): void => {
    const { state } = ctx;
    let killGold = 0;
    for (const event of ctx.tickEvents) {
      if (event.type === 'enemyKilled') {
        killGold += getEnemyType(enemies, event.enemyType).gold;
      }
    }
    if (killGold > 0) earnGold(state, killGold);
    if (state.gold !== state.reportedGold) {
      ctx.emit({
        type: 'goldChanged',
        tick: state.tick,
        gold: state.gold,
        delta: state.gold - state.reportedGold,
      });
      state.reportedGold = state.gold;
    }
  });
}
