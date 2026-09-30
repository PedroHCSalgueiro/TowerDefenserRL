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

/**
 * Fecha uma onda: juros primeiro, sobre o ouro guardado; depois o bônus; e a
 * loja nova grátis. É o que o botão "Encerrar onda" do debug e, mais tarde,
 * o fim de cada onda real chamam.
 */
export function endWave(ctx: TickContext, economy: EconomyData, towers: TowerData): void {
  const { state } = ctx;
  state.wave++;
  const interest = interestFor(economy, state.gold);
  state.gold += interest;
  const bonus = waveBonusFor(economy, state.wave);
  state.gold += bonus;
  state.shop = newShop(ctx.rng, economy, towers, state.nexus.level, false);
  ctx.emit({
    type: 'waveEnded',
    tick: state.tick,
    wave: state.wave,
    interest,
    bonus,
    gold: state.gold,
  });
  ctx.emit({ type: 'shopChanged', tick: state.tick, reason: 'newWave' });
}

/**
 * Sistema de ouro, depois dos gatilhos: soma o `gold` de cada inimigo morto
 * no tick (por qualquer autor, inclusive o núcleo) e emite `goldChanged` uma
 * vez por tick com o saldo final, nunca um por abate.
 */
export function createGoldSystem(enemies: EnemyData) {
  return (ctx: TickContext): void => {
    const { state } = ctx;
    for (const event of ctx.tickEvents) {
      if (event.type === 'enemyKilled') {
        state.gold += getEnemyType(enemies, event.enemyType).gold;
      }
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
