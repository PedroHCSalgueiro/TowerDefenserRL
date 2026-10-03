/**
 * Texto curto perto do mouse enquanto uma torre está na mão (T23): "sem
 * ligações aqui", a fusão ("funde: ★2↑") ou as ligações ("ativa 2 · carga 1"),
 * e a prévia de classes da loja (T16). O modelo é puro; a classe só mexe no DOM.
 */

import uiData from '../data/ui.json';
import type { LinkKind, LinkPreview } from '../sim/triggers/links';
import type { PurchasePreview } from './classPreview';

const config = uiData.linkHint;
const KINDS: readonly LinkKind[] = ['activates', 'charges', 'copies'];

/** Linhas do texto; vazio = nada a mostrar. */
export function linkHintLines(
  preview: LinkPreview | null,
  purchase: PurchasePreview | null,
): string[] {
  if (purchase?.fusion) return [`funde: ${purchase.fusion}`];
  const lines: string[] = [];
  if (preview) {
    if (preview.links.length === 0) {
      lines.push(config.texts.none);
    } else {
      const counts = KINDS.map((kind) => ({
        kind,
        n: preview.links.filter((l) => l.kind === kind).length,
      })).filter((c) => c.n > 0);
      lines.push(counts.map((c) => `${config.texts[c.kind]} ${c.n}`).join(' · '));
    }
  }
  if (purchase) lines.push(...purchase.classes);
  return lines;
}

export class LinkHint {
  private readonly el: HTMLElement;
  private mouse = { x: 0, y: 0 };
  private key = '';

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.mouse = { x: event.clientX, y: event.clientY };
    if (!this.el.hidden) this.place();
  };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'link-hint';
    this.el.hidden = true;
    parent.append(this.el);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  update(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (key !== this.key) {
      this.key = key;
      this.el.replaceChildren(
        ...lines.map((text) => {
          const line = document.createElement('div');
          line.textContent = text;
          return line;
        }),
      );
    }
    this.el.hidden = lines.length === 0;
    if (!this.el.hidden) this.place();
  }

  private place(): void {
    this.el.style.left = `${this.mouse.x + config.offsetX}px`;
    this.el.style.top = `${this.mouse.y + config.offsetY}px`;
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    this.el.remove();
  }
}
