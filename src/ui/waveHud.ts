/**
 * HUD das ondas, em HTML sobre o canvas: "Onda 3/40" ou "Ondas 5–7 de 40",
 * os inimigos restantes, o bônus antecipado pendente, o botão de chamar e os controles de velocidade e pausa.
 * Atalhos: Espaço chama (uma onda por toque), Q alterna 1x → 2x → 3x e P
 * pausa e despausa.
 */

import uiData from '../data/ui.json';
import type { RunState } from '../sim/state';
import { buildWaveHudModel, waveHudKey, type WaveHudModel } from './waveHudModel';

const hudTexts = uiData.waveHud.texts;

export interface WaveHudActions {
  onCall: () => void;
  onCycleSpeed: () => void;
  onTogglePause: () => void;
}

/** Velocidade e pausa do relógio (fora da simulação). */
export interface ClockView {
  speed: number;
  paused: boolean;
}

function hudButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `shop-button ${className}`;
  b.textContent = text;
  b.addEventListener('click', () => {
    onClick();
    // Sem foco no botão, as teclas do jogo continuam chegando.
    b.blur();
  });
  return b;
}

export class WaveHud {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly pending: HTMLElement;
  private readonly callButton: HTMLButtonElement;
  /** Janela do bônus antecipado: texto e barra embaixo do botão (T23). */
  private readonly windowBox: HTMLElement;
  private readonly windowText: HTMLElement;
  private readonly windowFill: HTMLElement;
  /** Faixa das próximas ondas, embaixo do HUD (T23). */
  private readonly upcoming: HTMLElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly pausedBanner: HTMLElement;
  private readonly actions: WaveHudActions;
  private key = '';

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') {
      // Sem isso, o Espaço também "clicaria" o botão que estiver com foco.
      event.preventDefault();
      if (!event.repeat) this.actions.onCall();
    } else if (event.repeat) {
      return;
    } else if (event.key === 'q' || event.key === 'Q') {
      this.actions.onCycleSpeed();
    } else if (event.key === 'p' || event.key === 'P') {
      this.actions.onTogglePause();
    }
  };

  constructor(parent: HTMLElement, actions: WaveHudActions) {
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.className = 'wave-hud';
    this.root.setAttribute('aria-label', 'Ondas');
    const div = (className: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = className;
      return el;
    };
    this.label = div('wave-label');
    this.detail = div('wave-detail');
    this.pending = div('wave-pending');
    this.callButton = hudButton('Chamar onda (Espaço)', 'wave-call', actions.onCall);
    const callGroup = div('wave-call-group');
    this.windowBox = div('wave-window');
    this.windowText = div('wave-window-text');
    const bar = div('wave-window-bar');
    this.windowFill = div('wave-window-fill');
    bar.append(this.windowFill);
    this.windowBox.append(this.windowText, bar);
    this.windowBox.hidden = true;
    callGroup.append(this.callButton, this.windowBox);
    this.upcoming = div('wave-upcoming');
    this.speedButton = hudButton('1x (Q)', 'wave-speed', actions.onCycleSpeed);
    this.pauseButton = hudButton('Pausar (P)', 'wave-pause', actions.onTogglePause);
    this.root.append(
      this.label,
      this.detail,
      this.pending,
      callGroup,
      this.speedButton,
      this.pauseButton,
    );
    this.pausedBanner = div('paused-banner');
    this.pausedBanner.textContent = 'Pausado (P)';
    this.pausedBanner.hidden = true;
    parent.append(this.root, this.upcoming, this.pausedBanner);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Chame a cada quadro: só refaz o DOM quando algo mudou. */
  update(state: Readonly<RunState>, clock: ClockView): void {
    const model = buildWaveHudModel(state, clock.paused);
    const key = `${waveHudKey(model)}|${clock.speed}|${clock.paused}`;
    if (key === this.key) return;
    this.key = key;
    this.label.textContent = model.label;
    this.detail.textContent = model.detail;
    this.pending.textContent = model.pendingBonus;
    this.pending.hidden = model.pendingBonus === '';
    this.callButton.textContent = model.callLabel;
    this.callButton.disabled = !model.canCall;
    this.windowBox.hidden = model.bonusWindow === null;
    if (model.bonusWindow) {
      this.windowText.textContent = model.bonusWindow.text;
      // A barra mostra o que ainda resta da janela.
      this.windowFill.style.width = `${Math.round((1 - model.bonusWindow.spent) * 100)}%`;
    }
    this.renderUpcoming(model.upcoming);
    this.speedButton.textContent = `${clock.speed}x (Q)`;
    this.pauseButton.textContent = clock.paused ? 'Continuar (P)' : 'Pausar (P)';
    this.pauseButton.classList.toggle('active', clock.paused);
    this.pausedBanner.hidden = !clock.paused;
  }

  private renderUpcoming(upcoming: WaveHudModel['upcoming']): void {
    this.upcoming.hidden = upcoming.length === 0;
    const parts: HTMLElement[] = [];
    const title = document.createElement('span');
    title.className = 'wave-upcoming-title';
    title.textContent = hudTexts.upcoming;
    parts.push(title);
    for (const { wave, kind } of upcoming) {
      const item = document.createElement('span');
      item.className = `wave-upcoming-item ${kind}`;
      item.textContent = String(wave);
      if (kind !== 'normal') {
        const mark = document.createElement('span');
        mark.className = 'wave-upcoming-mark';
        mark.textContent = kind === 'boss' ? hudTexts.bossMark : hudTexts.eliteMark;
        item.title = kind === 'boss' ? hudTexts.bossTitle : hudTexts.eliteTitle;
        item.append(mark);
      }
      parts.push(item);
    }
    this.upcoming.replaceChildren(...parts);
  }

  /** Põe mais um controle no fim do HUD (o botão "?" da ajuda, T17). */
  appendControl(control: HTMLElement): void {
    this.root.append(control);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
    this.upcoming.remove();
    this.pausedBanner.remove();
  }
}
