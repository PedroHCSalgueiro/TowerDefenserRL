/**
 * Modelo do HUD das ondas (sem DOM, para testar): "Onda 3/10", o que falta na
 * onda e se dá para chamar a próxima.
 */

import engineConfig from '../data/engine.json';
import type { RunState } from '../sim/state';
import { buildWaveSchedules, type WaveSchedule } from '../sim/waves/schedule';
import { waveData } from '../sim/waves/waveData';
import { callWaveRefusal, waveRemaining } from '../sim/waves/waves';

export const defaultWaveSchedules: readonly WaveSchedule[] = buildWaveSchedules(
  waveData,
  engineConfig.ticksPerSecond,
);

export interface WaveHudModel {
  /** "Onda 3/10": a onda em andamento ou a próxima a chamar. */
  label: string;
  /** Linha de baixo: inimigos restantes, aviso de mapa sujo ou vazio. */
  detail: string;
  canCall: boolean;
}

export function buildWaveHudModel(
  state: Readonly<RunState>,
  schedules: readonly WaveSchedule[] = defaultWaveSchedules,
): WaveHudModel {
  const total = schedules.length;
  // A onda em andamento ou a próxima a chamar (depois da última, a última).
  const label = `Onda ${Math.min(state.wave + 1, total)}/${total}`;
  const refusal = callWaveRefusal(state, total);
  let detail = '';
  if (state.waves.active) detail = `Restam ${waveRemaining(state, schedules)}`;
  else if (refusal === 'enemies') detail = `Limpe o mapa (${state.enemies.activeCount})`;
  else if (refusal === null) detail = 'Pronta para chamar';
  return { label, detail, canCall: refusal === null };
}

export function waveHudKey(model: WaveHudModel): string {
  return `${model.label}|${model.detail}|${model.canCall}`;
}
