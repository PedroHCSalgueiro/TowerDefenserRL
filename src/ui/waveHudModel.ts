/**
 * Modelo do HUD das ondas (sem DOM, para testar): "Onda 3/10" ou
 * "Ondas 5–7 de 10", o que falta, o multiplicador de ouro, o bônus antecipado
 * pendente e o botão de chamar (que vira "Chamar antecipada (+7)").
 */

import engineConfig from '../data/engine.json';
import { earlyBonusFor } from '../sim/economy/economy';
import { economyData, type EconomyData } from '../sim/economy/economyData';
import { enemyData, type EnemyData } from '../sim/enemies/enemyData';
import type { RunState } from '../sim/state';
import { buildWaveSchedules, type WaveSchedule } from '../sim/waves/schedule';
import { waveData } from '../sim/waves/waveData';
import { nextWaveNumber } from '../sim/waves/waveState';
import { callWaveRefusal, waveRemaining } from '../sim/waves/waves';

export const defaultWaveSchedules: readonly WaveSchedule[] = buildWaveSchedules(
  waveData,
  engineConfig.ticksPerSecond,
);

export interface WaveHudModel {
  /** "Onda 3/10" (a onda em andamento ou a próxima a chamar) ou "Ondas 5–7 de 10". */
  label: string;
  /** Linha de baixo: inimigos restantes, aviso de mapa sujo ou vazio. */
  detail: string;
  /** Multiplicador do ouro de abate ("x2!"); vazio quando é 1. */
  multiplier: string;
  /** Bônus antecipado das ondas em andamento, pago quando cada uma fechar ("+7 ao limpar"). */
  pendingBonus: string;
  /** Texto do botão de chamar. */
  callLabel: string;
  canCall: boolean;
}

/** "x1,5!", "x2!" (vírgula decimal). */
export function formatMultiplier(multiplier: number): string {
  return `x${String(multiplier).replace('.', ',')}!`;
}

export function buildWaveHudModel(
  state: Readonly<RunState>,
  paused = false,
  schedules: readonly WaveSchedule[] = defaultWaveSchedules,
  economy: EconomyData = economyData,
  enemies: EnemyData = enemyData,
): WaveHudModel {
  const total = schedules.length;
  const active = state.waves.active;
  const first = active[0]?.wave ?? Math.min(state.wave + 1, total);
  const last = active[active.length - 1]?.wave ?? first;
  const label = first === last ? `Onda ${first}/${total}` : `Ondas ${first}–${last} de ${total}`;

  const refusal = callWaveRefusal(state, schedules, enemies);
  let detail = '';
  if (active.length > 0) detail = `Restam ${waveRemaining(state, schedules)}`;
  else if (refusal === 'enemies') detail = `Limpe o mapa (${state.enemies.activeCount})`;
  else if (refusal === null) detail = 'Pronta para chamar';

  const multiplier =
    state.waves.goldMultiplier > 1 ? formatMultiplier(state.waves.goldMultiplier) : '';
  const pending = active.reduce((sum, w) => sum + w.earlyBonus, 0);
  const pendingBonus = pending > 0 ? `+${pending} ao limpar` : '';

  let callLabel = 'Chamar onda (Espaço)';
  if (refusal === 'active') callLabel = 'Chefão: limpe o mapa';
  else if (refusal === null && active.length > 0) {
    callLabel = `Chamar antecipada (+${earlyBonusFor(economy, nextWaveNumber(state))})`;
  }
  return {
    label,
    detail,
    multiplier,
    pendingBonus,
    callLabel,
    canCall: refusal === null && !paused,
  };
}

export function waveHudKey(model: WaveHudModel): string {
  return [
    model.label,
    model.detail,
    model.multiplier,
    model.pendingBonus,
    model.callLabel,
    model.canCall,
  ].join('|');
}
