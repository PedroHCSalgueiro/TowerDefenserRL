/**
 * Tela de recompensa (T24), em HTML sobre o canvas: três cartas quadradas no
 * centro, a barra do tempo para escolher e o botão de reroll das cartas.
 * Clique ou teclas 1, 2 e 3 escolhem; R (ou o botão) rerola. Tudo vira
 * comando da simulação, que é quem pausa o jogo enquanto a tela está aberta.
 * Com a pausa do relógio (P ou a ajuda), a tela não aceita nada.
 */

import uiConfig from '../data/ui.json';
import { classData } from '../sim/classes/classData';
import { rewardData } from '../sim/rewards/rewardData';
import type { RunState, SimCommand } from '../sim/state';
import {
  buildRewardScreenModel,
  fillText,
  rewardScreenKey,
  type RewardCardModel,
  type RewardScreenModel,
} from './rewardScreenModel';

const texts = uiConfig.rewardScreen;

export interface RewardScreenDeps {
  parent: HTMLElement;
  state: () => Readonly<RunState>;
  enqueue: (command: SimCommand) => void;
  /** Pausa do relógio (P ou ajuda): a tela não aceita escolha nem reroll. */
  paused: () => boolean;
  ticksPerSecond: number;
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

export class RewardScreen {
  private readonly deps: RewardScreenDeps;
  private readonly overlay: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly timerFill: HTMLElement;
  private readonly timerText: HTMLElement;
  private model: RewardScreenModel | null = null;
  private key = '';

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || !this.model) return;
    const card = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (card >= 0 && card < this.model.cards.length) this.choose(card);
    else if (event.key.toLowerCase() === texts.rerollKey) this.reroll();
  };

  constructor(deps: RewardScreenDeps) {
    this.deps = deps;
    this.overlay = el('div', 'reward-screen');
    this.overlay.hidden = true;
    this.panel = el('div', 'reward-panel');
    const timer = el('div', 'reward-timer');
    this.timerFill = el('div', 'reward-timer-fill');
    timer.append(this.timerFill);
    this.timerText = el('div', 'reward-timer-text');
    const box = el('div', 'reward-box');
    box.append(this.panel, timer, this.timerText);
    this.overlay.append(box);
    deps.parent.append(this.overlay);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** A tela está aberta (a simulação está congelada). */
  get open(): boolean {
    return this.model !== null;
  }

  private choose(index: number): void {
    if (!this.deps.paused()) this.deps.enqueue({ type: 'chooseReward', index });
  }

  private reroll(): void {
    if (!this.deps.paused() && this.model?.canReroll) this.deps.enqueue({ type: 'rerollRewards' });
  }

  private renderCard(card: RewardCardModel): HTMLElement {
    const node = el('button', 'reward-card');
    node.type = 'button';
    node.style.setProperty('--card-color', card.color);
    node.append(
      el('div', 'reward-card-key', card.key),
      el('div', 'reward-card-category', card.category),
      el('div', 'reward-card-name', card.name),
      el('div', 'reward-card-text', card.text),
    );
    if (card.repeatable) node.append(el('div', 'reward-card-repeat', texts.repeatable));
    node.addEventListener('click', () => {
      this.choose(card.index);
      node.blur();
    });
    return node;
  }

  private render(model: RewardScreenModel): void {
    const header = el('div', 'reward-header');
    header.append(el('h2', 'reward-title', model.title));
    if (model.queued) header.append(el('span', 'reward-queued', model.queued));
    const cards = el('div', 'reward-cards');
    cards.append(...model.cards.map((card) => this.renderCard(card)));
    const reroll = el(
      'button',
      'shop-button reward-reroll',
      fillText(texts.rerollLabel, { cost: model.rerollCost }),
    );
    reroll.type = 'button';
    reroll.disabled = !model.canReroll;
    reroll.addEventListener('click', () => {
      this.reroll();
      reroll.blur();
    });
    this.panel.replaceChildren(header, el('p', 'reward-subtitle', texts.subtitle), cards, reroll);
  }

  /** Chame a cada quadro: cartas só quando mudam; a barra do tempo sempre. */
  update(): void {
    this.model = buildRewardScreenModel(
      this.deps.state(),
      rewardData,
      classData,
      this.deps.ticksPerSecond,
    );
    const model = this.model;
    this.overlay.hidden = model === null;
    const key = rewardScreenKey(model);
    if (key !== this.key) {
      this.key = key;
      if (model) this.render(model);
    }
    if (model) {
      this.timerFill.style.width = `${(model.timeLeft * 100).toFixed(1)}%`;
      this.timerText.textContent = fillText(texts.seconds, { s: model.seconds });
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.overlay.remove();
  }
}
