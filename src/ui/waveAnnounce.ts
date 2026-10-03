/**
 * Aviso grande na chamada de uma onda de elite (roxo) ou de chefão
 * (vermelho), em HTML sobre o canvas (T23). Some sozinho depois de
 * `waveAnnounce.durationMs`. A onda com chefão e elites conta como chefão.
 */

import uiData from '../data/ui.json';
import type { EnemyData } from '../sim/enemies/enemyData';
import type { SimEvent } from '../sim/engine/events';
import type { WaveSchedule } from '../sim/waves/schedule';
import { waveKindOf } from '../sim/waves/waves';

const config = uiData.waveAnnounce;

export interface WaveAnnouncement {
  kind: 'elite' | 'boss';
  text: string;
}

/** O aviso das ondas chamadas neste lote de eventos (o da última, se vierem várias). */
export function waveAnnouncementFor(
  events: readonly SimEvent[],
  schedules: readonly WaveSchedule[],
  enemies: EnemyData,
): WaveAnnouncement | null {
  let found: WaveAnnouncement | null = null;
  for (const event of events) {
    if (event.type !== 'waveStarted') continue;
    const schedule = schedules[event.wave - 1];
    if (!schedule) continue;
    const kind = waveKindOf(schedule, enemies);
    if (kind !== 'normal') found = { kind, text: config.texts[kind] };
  }
  return found;
}

export class WaveAnnounce {
  private readonly el: HTMLElement;
  private hideAt = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'wave-announce';
    this.el.hidden = true;
    parent.append(this.el);
  }

  /** Chame a cada quadro com os eventos do quadro e o relógio da página. */
  update(announcement: WaveAnnouncement | null, nowMs: number): void {
    if (announcement) {
      this.el.textContent = announcement.text;
      this.el.className = `wave-announce ${announcement.kind}`;
      this.el.hidden = false;
      this.hideAt = nowMs + config.durationMs;
    } else if (!this.el.hidden && nowMs >= this.hideAt) {
      this.el.hidden = true;
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
