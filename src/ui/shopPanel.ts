/**
 * Barra da loja, em HTML sobre o canvas: ouro, juros previstos, os 5 slots
 * (nome, classes, raridade e preço; esmaecido sem ouro), rerolar e vender.
 */

import uiData from '../data/ui.json';
import type { ShopModel, ShopSlotModel } from './shopModel';

const shopTexts = uiData.shop;

export interface ShopPanelHandlers {
  onSlotPointerDown: (slot: number, event: PointerEvent) => void;
  onReroll: () => void;
  onSell: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ShopPanel {
  private readonly root: HTMLElement;
  private readonly handlers: ShopPanelHandlers;
  private hovered: number | null = null;

  constructor(parent: HTMLElement, handlers: ShopPanelHandlers) {
    this.handlers = handlers;
    this.root = el('div', 'shop-panel');
    this.root.setAttribute('aria-label', 'Loja');
    parent.append(this.root);
    // Por delegação: o DOM dos slots é refeito quando o ouro muda, e o slot sob o mouse continua valendo.
    this.root.addEventListener('pointerover', (event) => {
      const slot = (event.target as Element).closest<HTMLElement>('.shop-slot');
      this.hovered = slot ? Number(slot.dataset.slot) : null;
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovered = null;
    });
  }

  /** Slot sob o mouse (`null` = nenhum). */
  get hoveredSlot(): number | null {
    return this.hovered;
  }

  render(model: ShopModel, carrySlot: number | null): void {
    const status = el('div', 'shop-status');
    status.append(
      el('div', 'shop-gold', `Ouro ${model.gold}`),
      el('div', 'shop-interest', `Juros previstos +${model.interest}`),
      el('div', 'shop-wave', `Fim da onda ${model.nextWave}`),
    );

    const slots = el('div', 'shop-slots');
    slots.append(...model.slots.map((slot) => this.renderSlot(slot, carrySlot === slot.index)));

    const actions = el('div', 'shop-actions');
    const reroll = el(
      'button',
      'shop-button',
      model.rerollCost === 0
        ? shopTexts.freeRerollLabel
        : shopTexts.rerollLabel.replace('{cost}', String(model.rerollCost)),
    );
    reroll.type = 'button';
    reroll.disabled = !model.canReroll;
    reroll.addEventListener('click', () => {
      this.handlers.onReroll();
      reroll.blur();
    });
    const sell = el(
      'button',
      'shop-button',
      model.sell ? `Vender ${model.sell.name} (S) +${model.sell.refund}` : 'Vender (S)',
    );
    sell.type = 'button';
    sell.disabled = model.sell === null;
    sell.addEventListener('click', () => {
      this.handlers.onSell();
      sell.blur();
    });
    actions.append(reroll, sell);

    this.root.replaceChildren(status, slots, actions);
  }

  private renderSlot(slot: ShopSlotModel, carried: boolean): HTMLElement {
    const empty = slot.towerType === null;
    const classes = ['shop-slot'];
    if (empty) classes.push('shop-slot-empty');
    else {
      classes.push(`shop-rarity-${slot.rarity}`);
      if (!slot.affordable || slot.blockedByLimit) classes.push('shop-slot-dim');
    }
    if (carried) classes.push('shop-slot-carried');
    const node = el('div', classes.join(' '));
    node.dataset.slot = String(slot.index);
    node.append(el('div', 'shop-key', String(slot.index + 1)));
    if (empty) {
      node.append(el('div', 'shop-name', 'Comprada'));
      return node;
    }
    if (slot.fuseStar !== null) {
      classes.push('shop-slot-fuse');
      node.className = classes.join(' ');
      node.append(el('div', 'shop-fuse', `★${slot.fuseStar}↑`));
    }
    if (slot.blockedByLimit) {
      node.append(el('div', 'shop-limit', uiData.texts.limitWarning));
    }
    node.append(
      el('div', 'shop-name', slot.name),
      el('div', 'shop-summary', slot.summary),
      el('div', 'shop-classes', slot.classes.join(' · ')),
      el('div', 'shop-rarity', slot.rarityLabel),
      el('div', 'shop-price', `${slot.price}`),
    );
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.handlers.onSlotPointerDown(slot.index, event);
    });
    return node;
  }

  destroy(): void {
    this.root.remove();
  }
}
