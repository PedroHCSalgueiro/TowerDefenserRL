/**
 * HUD das ondas, em HTML sobre o canvas: "Onda 3/10", os inimigos restantes e
 * o botão "Chamar onda". A tecla Espaço faz o mesmo que o botão.
 */

import type { RunState } from '../sim/state';
import { buildWaveHudModel, waveHudKey } from './waveHudModel';

export class WaveHud {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly onCall: () => void;
  private key = '';

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
    // Sem isso, o Espaço também "clicaria" o botão que estiver com foco.
    event.preventDefault();
    if (!event.repeat) this.onCall();
  };

  constructor(parent: HTMLElement, onCall: () => void) {
    this.onCall = onCall;
    this.root = document.createElement('div');
    this.root.className = 'wave-hud';
    this.root.setAttribute('aria-label', 'Ondas');
    this.label = document.createElement('div');
    this.label.className = 'wave-label';
    this.detail = document.createElement('div');
    this.detail.className = 'wave-detail';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'shop-button wave-call';
    this.button.textContent = 'Chamar onda (Espaço)';
    this.button.addEventListener('click', () => {
      this.onCall();
      // Sem foco no botão, as teclas do jogo continuam chegando.
      this.button.blur();
    });
    this.root.append(this.label, this.detail, this.button);
    parent.append(this.root);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Chame a cada quadro: só refaz o DOM quando algo mudou. */
  update(state: Readonly<RunState>): void {
    const model = buildWaveHudModel(state);
    const key = waveHudKey(model);
    if (key === this.key) return;
    this.key = key;
    this.label.textContent = model.label;
    this.detail.textContent = model.detail;
    this.button.disabled = !model.canCall;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.remove();
  }
}
