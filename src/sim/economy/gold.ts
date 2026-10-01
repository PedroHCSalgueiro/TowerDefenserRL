/**
 * Entrada e saída de ouro que dependem das trapaças (T17): gastar respeita o
 * "ouro infinito" e ganhar soma em `stats.goldEarned`.
 */

import type { RunState } from '../state';

/** Paga `amount`; com o "ouro infinito" do debug ligado, o ouro não diminui. */
export function spendGold(state: RunState, amount: number): void {
  if (!state.debug.infiniteGold) state.gold -= amount;
}

/** Ouro ganho na run (juros, bônus e abates): entra no saldo e no total da run. */
export function earnGold(state: RunState, amount: number): void {
  state.gold += amount;
  state.stats.goldEarned += amount;
}
