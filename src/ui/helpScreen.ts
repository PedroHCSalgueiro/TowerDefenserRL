/**
 * Tela de ajuda (T17): a tecla H e o botão "?" abrem a lista de controles por
 * cima do jogo. Abrir pausa; fechar (H, Esc ou o botão) volta como estava.
 * Com a ajuda aberta, as outras teclas não chegam ao jogo.
 */

import uiConfig from '../data/ui.json';
import { helpLines } from './helpModel';

const { help } = uiConfig;

export interface HelpScreenDeps {
  parent: HTMLElement;
  /** Pausa do relógio (fora da simulação). */
  paused: () => boolean;
  setPaused: (paused: boolean) => void;
  debugUnlocked: () => boolean;
}

export class HelpScreen {
  private readonly deps: HelpScreenDeps;
  private readonly overlay: HTMLElement;
  private readonly table: HTMLTableElement;
  private readonly button: HTMLButtonElement;
  private pausedBefore = false;

  // Na fase de captura: com a ajuda aberta, as teclas do jogo não chegam aos
  // outros controles (os atalhos com Ctrl, Alt ou Cmd continuam valendo).
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const isHelpKey = event.key.toLowerCase() === help.key;
    if (this.isOpen) {
      event.stopImmediatePropagation();
      if (event.code === 'Space') event.preventDefault();
      if (!event.repeat && (isHelpKey || event.key === 'Escape')) this.close();
    } else if (isHelpKey && !event.repeat) {
      this.open();
    }
  };

  constructor(deps: HelpScreenDeps) {
    this.deps = deps;
    this.overlay = document.createElement('div');
    this.overlay.className = 'help-screen';
    this.overlay.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'help-panel';
    const title = document.createElement('h2');
    title.textContent = help.title;
    this.table = document.createElement('table');
    this.table.className = 'help-table';
    const note = document.createElement('p');
    note.textContent = help.pausedNote;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-button';
    close.textContent = help.closeLabel;
    close.addEventListener('click', () => this.close());
    panel.append(title, this.table, note, close);
    this.overlay.append(panel);
    // Clique fora do painel fecha.
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'shop-button help-button';
    this.button.textContent = help.buttonLabel;
    this.button.addEventListener('click', () => {
      this.button.blur();
      if (this.isOpen) this.close();
      else this.open();
    });

    deps.parent.append(this.overlay);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** O botão "?", para a cena pôr no HUD. */
  get toggleButton(): HTMLButtonElement {
    return this.button;
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.table.replaceChildren(
      ...helpLines(this.deps.debugUnlocked()).map((line) => {
        const tr = document.createElement('tr');
        if (line.debug) tr.className = 'help-debug';
        const keys = document.createElement('td');
        keys.className = 'help-keys';
        keys.textContent = line.keys;
        const action = document.createElement('td');
        action.textContent = line.action;
        tr.append(keys, action);
        return tr;
      }),
    );
    this.pausedBefore = this.deps.paused();
    this.deps.setPaused(true);
    this.overlay.hidden = false;
  }

  close(): void {
    if (!this.isOpen) return;
    this.overlay.hidden = true;
    this.deps.setPaused(this.pausedBefore);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.overlay.remove();
    this.button.remove();
  }
}
