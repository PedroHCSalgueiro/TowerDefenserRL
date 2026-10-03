/**
 * Cartão do mini tutorial (T23), em HTML sobre o canvas. Não pausa o jogo:
 * só mostra o cartão que o `TutorialModel` mandar, com "Ok" nos que fecham
 * com clique e "Pular tutorial" em todos.
 */

import uiData from '../data/ui.json';
import { TutorialModel, type TutorialCard, type TutorialStorage } from './tutorialModel';

const config = uiData.tutorial;

function safeLocalStorage(): TutorialStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class Tutorial {
  private readonly model: TutorialModel;
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly ok: HTMLButtonElement;
  private shownId: string | null = null;

  constructor(parent: HTMLElement, storage: TutorialStorage | null = safeLocalStorage()) {
    this.model = new TutorialModel(storage);
    this.root = document.createElement('div');
    this.root.className = 'tutorial-card';
    this.root.hidden = true;
    this.text = document.createElement('div');
    this.text.className = 'tutorial-text';
    const buttons = document.createElement('div');
    buttons.className = 'tutorial-buttons';
    this.ok = this.button(config.closeLabel, () => this.model.close());
    const skip = this.button(config.skipLabel, () => this.model.skip());
    skip.classList.add('tutorial-skip');
    buttons.append(this.ok, skip);
    this.root.append(this.text, buttons);
    parent.append(this.root);
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shop-button';
    b.textContent = label;
    b.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
      b.blur();
    });
    return b;
  }

  /** Chame a cada quadro. */
  update(state: Parameters<TutorialModel['update']>[0], nowMs: number): void {
    const card: TutorialCard | null = this.model.update(state, nowMs);
    this.root.hidden = card === null;
    if (!card || card.id === this.shownId) return;
    this.shownId = card.id;
    this.text.textContent = card.text;
    this.ok.hidden = !card.closable;
  }

  destroy(): void {
    this.root.remove();
  }
}
