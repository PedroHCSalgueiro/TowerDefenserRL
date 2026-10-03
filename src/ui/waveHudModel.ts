/**
 * Modelo do HUD das ondas (sem DOM, para testar): "Onda 3/40" ou
 * "Ondas 5–7 de 40", o que falta, o bônus antecipado pendente, o botão de
 * chamar (que vira "Chamar antecipada (+10)" com a janela do bônus, ou
 * "Chamar próxima onda (sem bônus)" depois dela) e a faixa das próximas ondas
 * com elite e chefão marcados (T23).
 */

import engineConfig from '../data/engine.json';
import uiData from '../data/ui.json';
import { earlyBonusFor } from '../sim/economy/economy';
import { economyData, type EconomyData } from '../sim/economy/economyData';
import { enemyData, type EnemyData } from '../sim/enemies/enemyData';
import type { RunState } from '../sim/state';
import { buildWaveSchedules, type WaveSchedule } from '../sim/waves/schedule';
import { waveData } from '../sim/waves/waveData';
import {
  callWaveRefusal,
  earlyBonusWindow,
  waveKindOf,
  waveRemaining,
  type WaveKind,
} from '../sim/waves/waves';

const hudTexts = uiData.waveHud.texts;

export const defaultWaveSchedules: readonly WaveSchedule[] = buildWaveSchedules(
  waveData,
  engineConfig.ticksPerSecond,
);

export interface WaveHudModel {
  /** "Onda 3/10" (a onda em andamento ou a próxima a chamar) ou "Ondas 5–7 de 10". */
  label: string;
  /** Linha de baixo: inimigos restantes, aviso de mapa sujo ou vazio. */
  detail: string;
  /** Bônus antecipado das ondas em andamento, pago quando cada uma fechar ("+15 ao limpar"). */
  pendingBonus: string;
  /** Texto do botão de chamar. */
  callLabel: string;
  canCall: boolean;
  /** Janela do bônus antecipado ainda aberta: "bônus por mais 6 inimigos" e a barra (0 a 1 gasto). */
  bonusWindow: { text: string; spent: number } | null;
  /** As próximas ondas a chamar (depois das em andamento), com o tipo. */
  upcoming: { wave: number; kind: WaveKind }[];
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

  const pending = active.reduce((sum, w) => sum + w.earlyBonus, 0);
  const pendingBonus = pending > 0 ? `+${pending} ao limpar` : '';

  let callLabel = 'Chamar onda (Espaço)';
  let bonusWindow: WaveHudModel['bonusWindow'] = null;
  if (refusal === 'active') callLabel = 'Chefão: limpe o mapa';
  else if (refusal === null && active.length > 0) {
    const window = earlyBonusWindow(state, schedules, economy);
    if (window?.open) {
      callLabel = hudTexts.callEarly.replace(
        '{bonus}',
        String(earlyBonusFor(economy, active.length)),
      );
      bonusWindow = {
        text: hudTexts.bonusWindow
          .replace('{n}', String(window.remaining))
          .replace('{inimigos}', window.remaining === 1 ? 'inimigo' : 'inimigos'),
        spent: window.spent,
      };
    } else {
      callLabel = hudTexts.callNoBonus;
    }
  }

  const upcoming: WaveHudModel['upcoming'] = [];
  const next = state.wave + active.length + 1;
  for (let n = next; n < next + uiData.waveHud.upcomingCount && n <= total; n++) {
    upcoming.push({ wave: n, kind: waveKindOf(schedules[n - 1]!, enemies) });
  }
  return {
    label,
    detail,
    pendingBonus,
    callLabel,
    canCall: refusal === null && !paused,
    bonusWindow,
    upcoming,
  };
}

export function waveHudKey(model: WaveHudModel): string {
  return [
    model.label,
    model.detail,
    model.pendingBonus,
    model.callLabel,
    model.canCall,
    model.bonusWindow?.text ?? '',
    model.bonusWindow ? Math.round(model.bonusWindow.spent * 100) : '',
    model.upcoming.map((u) => `${u.wave}${u.kind[0]}`).join(','),
  ].join('|');
}
