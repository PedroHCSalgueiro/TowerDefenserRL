/**
 * Painel do núcleo, em HTML sobre o canvas: nível, vida, "Torres 3/4", chances
 * de raridade atuais e do próximo nível e o botão "Evoluir (custo)". O núcleo
 * não tem teto (T22): o botão sempre mostra o custo do próximo nível. A tecla
 * E é tratada pelo controle da loja.
 */

import { economyData } from '../sim/economy/economyData';
import type { RunState } from '../sim/state';
import { RARITIES, type Rarity } from '../sim/towers/towerData';
import { buildNexusPanelModel, nexusPanelKey, type NexusPanelModel } from './nexusPanelModel';
import { RARITY_LABELS } from './shopModel';

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

function chancesText(chances: Readonly<Record<Rarity, number>>): string {
  return RARITIES.map((r) => `${RARITY_LABELS[r]} ${chances[r]}%`).join(' · ');
}

export class NexusPanel {
  private readonly root: HTMLElement;
  private readonly onEvolve: () => void;
  private key = '';

  constructor(parent: HTMLElement, onEvolve: () => void) {
    this.onEvolve = onEvolve;
    this.root = el('div', 'nexus-panel');
    this.root.setAttribute('aria-label', 'Núcleo');
    parent.append(this.root);
  }

  /** Chame a cada quadro: só refaz o DOM quando algo mudou. */
  update(state: Readonly<RunState>): void {
    const model = buildNexusPanelModel(state, economyData);
    const key = nexusPanelKey(model);
    if (key === this.key) return;
    this.key = key;
    this.render(model);
  }

  private render(model: NexusPanelModel): void {
    const full = model.towers >= model.towerLimit;
    const button = el(
      'button',
      'shop-button nexus-evolve',
      model.cost === null ? 'Evoluir (E)' : `Evoluir (E) −${model.cost}`,
    );
    button.type = 'button';
    button.disabled = !model.canEvolve;
    button.addEventListener('click', () => {
      this.onEvolve();
      button.blur();
    });
    this.root.replaceChildren(
      el('div', 'nexus-title', `Núcleo nível ${model.level}`),
      el('div', 'nexus-hp', `Vida ${model.hp}/${model.maxHp}`),
      el(
        'div',
        `nexus-towers${full ? ' nexus-towers-full' : ''}`,
        `Torres ${model.towers}/${model.towerLimit}` +
          (model.nextTowerLimit !== null ? ` (próx. ${model.nextTowerLimit})` : ''),
      ),
      el('div', 'nexus-chances', `Loja agora: ${chancesText(model.chances)}`),
      ...(model.nextChances
        ? [
            el(
              'div',
              'nexus-chances nexus-chances-next',
              `Próximo: ${chancesText(model.nextChances)}`,
            ),
          ]
        : []),
      button,
    );
  }

  destroy(): void {
    this.root.remove();
  }
}
