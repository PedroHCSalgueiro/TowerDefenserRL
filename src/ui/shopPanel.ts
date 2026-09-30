/**
 * Barra da loja, em HTML sobre o canvas: ouro, juros previstos, os 5 slots
 * (nome, classes, raridade e preço; esmaecido sem ouro), rerolar e vender.
 */

import type { ShopModel, ShopSlotModel } from './shopModel';

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

  constructor(parent: HTMLElement, handlers: ShopPanelHandlers) {
    this.handlers = handlers;
    this.root = el('div', 'shop-panel');
    this.root.setAttribute('aria-label', 'Loja');
    parent.append(this.root);
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
    const reroll = el('button', 'shop-button', `Rerolar (R) −${model.rerollCost}`);
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
      if (!slot.affordable) classes.push('shop-slot-dim');
    }
    if (carried) classes.push('shop-slot-carried');
    const node = el('div', classes.join(' '));
    node.dataset.slot = String(slot.index);
    node.append(el('div', 'shop-key', String(slot.index + 1)));
    if (empty) {
      node.append(el('div', 'shop-name', 'Comprada'));
      return node;
    }
    node.append(
      el('div', 'shop-name', slot.name),
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
