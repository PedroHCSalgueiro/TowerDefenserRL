/**
 * HUD das ondas, em HTML sobre o canvas: "Onda 3/40" ou "Ondas 5–7 de 40",
 * os inimigos restantes, o bônus antecipado pendente, o botão de chamar e os controles de velocidade e pausa.
 * Atalhos: Espaço chama (uma onda por toque), Q alterna 1x → 2x → 3x e P
 * pausa e despausa.
 */

import type { RunState } from '../sim/state';
import { buildWaveHudModel, waveHudKey } from './waveHudModel';

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
    this.speedButton = hudButton('1x (Q)', 'wave-speed', actions.onCycleSpeed);
    this.pauseButton = hudButton('Pausar (P)', 'wave-pause', actions.onTogglePause);
    this.root.append(
      this.label,
      this.detail,
      this.pending,
      this.callButton,
      this.speedButton,
      this.pauseButton,
    );
    this.pausedBanner = div('paused-banner');
    this.pausedBanner.textContent = 'Pausado (P)';
    this.pausedBanner.hidden = true;
    parent.append(this.root, this.pausedBanner);
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
    this.speedButton.textContent = `${clock.speed}x (Q)`;
    this.pauseButton.textContent = clock.paused ? 'Continuar (P)' : 'Pausar (P)';
    this.pauseButton.classList.toggle('active', clock.paused);
    this.pausedBanner.hidden = !clock.paused;
  }

  /** Põe mais um controle no fim do HUD (o botão "?" da ajuda, T17). */
  appendControl(control: HTMLElement): void {
    this.root.append(control);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
    this.pausedBanner.remove();
  }
}
