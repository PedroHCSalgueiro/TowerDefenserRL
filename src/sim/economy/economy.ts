/**
 * Regras do ouro: juros e bônus de fim de onda, ouro por abate e o
 * fechamento da onda. Sem estado próprio; tudo vive em `RunState`.
 */

import type { EnemyData } from '../enemies/enemyData';
import { getEnemyType } from '../enemies/enemyData';
import type { TickContext } from '../engine/simulation';
import { newShop } from '../shop/shop';
import type { TowerData } from '../towers/towerData';
import type { EconomyData } from './economyData';

/** Juros sobre o ouro guardado: porcentagem arredondada para baixo, com teto. */
export function interestFor(economy: EconomyData, gold: number): number {
  const { percent, cap } = economy.interest;
  return Math.min(cap, Math.floor((Math.max(0, gold) * percent) / 100));
}

/** Bônus de fim da onda `wave` (a primeira onda é a 1). */
export function waveBonusFor(economy: EconomyData, wave: number): number {
  return economy.waveBonus.base + economy.waveBonus.perWave * wave;
}

/** Bônus da chamada antecipada da onda `wave`: porcentagem do bônus dela, arredondada para baixo. */
export function earlyBonusFor(economy: EconomyData, wave: number): number {
  return Math.floor((waveBonusFor(economy, wave) * economy.earlyCall.bonusPercent) / 100);
}

/**
 * Multiplicador do ouro de abate com `liveWaves` ondas com inimigo vivo ou
 * por nascer: `1 + perExtraWave × (liveWaves − 1)`, com teto (1 sem ondas).
 */
export function killGoldMultiplierFor(economy: EconomyData, liveWaves: number): number {
  const { perExtraWave, max } = economy.killGoldMultiplier;
  return Math.min(max, 1 + perExtraWave * Math.max(0, liveWaves - 1));
}

/**
 * Fecha uma onda: juros primeiro, sobre o ouro guardado; depois o bônus; o
 * bônus da chamada antecipada daquela onda, se houver; e a loja nova grátis.
 * É o que o fim de cada onda real e o "Encerrar onda" do debug chamam.
 */
export function endWave(
  ctx: TickContext,
  economy: EconomyData,
  towers: TowerData,
  earlyBonus = 0,
): void {
  const { state } = ctx;
  state.wave++;
  const interest = interestFor(economy, state.gold);
  state.gold += interest;
  const bonus = waveBonusFor(economy, state.wave);
  state.gold += bonus;
  state.gold += earlyBonus;
  state.shop = newShop(ctx.rng, economy, towers, state.nexus.level, false);
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
 * no tick (por qualquer autor, inclusive o núcleo), vezes o multiplicador das
 * ondas empilhadas. A fração que sobra fica guardada no estado e entra no
 * próximo abate. Emite `goldChanged` uma vez por tick com o saldo final,
 * nunca um por abate.
 */
export function createGoldSystem(enemies: EnemyData) {
  return (ctx: TickContext): void => {
    const { state } = ctx;
    let killGold = 0;
    for (const event of ctx.tickEvents) {
      if (event.type === 'enemyKilled') {
        killGold += getEnemyType(enemies, event.enemyType).gold;
      }
    }
    if (killGold > 0) {
      // Mesma conta em qualquer máquina (e exata com multiplicadores de 0,5 em 0,5).
      const total = killGold * state.waves.goldMultiplier + state.waves.goldFraction;
      const whole = Math.floor(total);
      state.gold += whole;
      state.waves.goldFraction = total - whole;
    }
    if (state.gold !== state.reportedGold) {
      ctx.emit({
        type: 'goldChanged',
        tick: state.tick,
        gold: state.gold,
        delta: state.gold - state.reportedGold,
      });
      state.reportedGold = state.gold;
    }
  };
}
