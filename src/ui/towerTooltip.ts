/**
 * Janela de informações da torre: aparece ao parar o mouse numa torre do
 * mapa ou num slot da loja e segue o mouse. Só HTML; quem chama diz qual
 * torre mostrar a cada quadro.
 */

import uiConfig from '../data/ui.json';
import type { PurchasePreview } from './classPreview';
import type { TowerInfo } from './towerInfo';

const { delayMs, offsetX, offsetY, edgeMarginPx } = uiConfig.tooltip;

function el(className: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class TowerTooltip {
  private readonly root: HTMLDivElement;
  private readonly parent: HTMLElement;
  private mouse = { x: 0, y: 0 };
  private overCanvas = false;
  private key: string | null = null;
  private since = 0;
  private shown = false;

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.mouse = { x: event.clientX, y: event.clientY };
    this.overCanvas = event.target instanceof HTMLCanvasElement;
    if (this.shown) this.place();
  };

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.root = el('tower-tip');
    this.root.hidden = true;
    parent.append(this.root);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  /** A janela está aberta (passou a espera)? */
  get visible(): boolean {
    return this.shown;
  }

  /** O mouse está sobre o mapa (e não sobre a loja ou outro painel)? */
  get pointerOverCanvas(): boolean {
    return this.overCanvas;
  }

  /**
   * Chame a cada quadro. `info` é a torre a mostrar (`null` = nenhuma) e `key`
   * identifica a torre e a estrela: a espera de `delayMs` recomeça quando ela muda.
   * `purchase`: prévia da compra (só no slot da loja).
   */
  update(
    info: TowerInfo | null,
    key: string | null,
    now: number,
    purchase: PurchasePreview | null = null,
  ): void {
    if (info === null || key === null) {
      this.key = null;
      this.hide();
      return;
    }
    if (key !== this.key) {
      this.key = key;
      this.since = now;
      this.hide();
      this.fill(info, purchase);
    }
    if (!this.shown && now - this.since >= delayMs) {
      this.shown = true;
      this.root.hidden = false;
      this.place();
    }
  }

  private fill(info: TowerInfo, purchase: PurchasePreview | null): void {
    const parts = [el('tower-tip-title', info.title)];
    if (info.summary) parts.push(el('tower-tip-summary', info.summary));
    parts.push(el('tower-tip-sub', info.subtitle));
    parts.push(labelled('Ataque', info.attack));
    if (info.trigger) parts.push(labelled('Gatilho', info.trigger));
    if (purchase?.fusion) parts.push(labelled('Compra', `funde: ${purchase.fusion}`));
    else if (purchase && purchase.classes.length > 0) {
      parts.push(labelled('Compra', purchase.classes.join('\n')));
    }
    this.root.replaceChildren(...parts);
  }

  private hide(): void {
    this.shown = false;
    this.root.hidden = true;
  }

  private place(): void {
    const area = this.parent.getBoundingClientRect();
    const tip = this.root.getBoundingClientRect();
    let x = this.mouse.x + offsetX;
    let y = this.mouse.y + offsetY;
    if (x + tip.width > area.right - edgeMarginPx) x = this.mouse.x - offsetX - tip.width;
    if (y + tip.height > area.bottom - edgeMarginPx) y = this.mouse.y - offsetY - tip.height;
    x = Math.max(area.left + edgeMarginPx, x);
    y = Math.max(area.top + edgeMarginPx, y);
    this.root.style.left = `${x - area.left}px`;
    this.root.style.top = `${y - area.top}px`;
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    this.root.remove();
  }
}

function labelled(label: string, text: string): HTMLDivElement {
  const row = el('tower-tip-row');
  row.append(el('tower-tip-label', label), el('tower-tip-text', text));
  return row;
}
