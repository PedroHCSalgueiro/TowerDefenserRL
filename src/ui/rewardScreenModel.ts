/**
 * Modelo da tela de recompensa (T24): transforma a tela aberta no estado em
 * cartas prontas para mostrar (nome, frase, categoria e cor), o custo do
 * reroll e o tempo restante. Sem DOM, para testar direto.
 */

import renderConfig from '../data/render.json';
import uiConfig from '../data/ui.json';
import type { ClassData } from '../sim/classes/classData';
import { getReward, type RewardCategory, type RewardData } from '../sim/rewards/rewardData';
import { rewardRerollCost } from '../sim/rewards/rewards';
import type { RewardOption } from '../sim/rewards/rewardState';
import type { RunState } from '../sim/state';

const texts = uiConfig.rewardScreen;
const classColors: Readonly<Record<string, string>> = renderConfig.towers.classColors;
const categoryColors: Readonly<Partial<Record<RewardCategory, string>>> = texts.categoryColors;

export interface RewardCardModel {
  index: number;
  /** Tecla da carta ("1", "2", "3"). */
  key: string;
  rewardId: string;
  name: string;
  text: string;
  /** "Classe · Arcana", "Economia"... */
  category: string;
  /** Cor da classe (cartas de classe) ou da categoria. */
  color: string;
  repeatable: boolean;
}

export interface RewardScreenModel {
  title: string;
  /** "+1 na fila" ou vazio. */
  queued: string;
  cards: RewardCardModel[];
  rerollCost: number;
  canReroll: boolean;
  /** Segundos restantes, arredondados para cima. */
  seconds: number;
  /** Fração do tempo que ainda resta (1 = cheio, 0 = acabou). */
  timeLeft: number;
}

export function fillText(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

/** Uma carta: o coringa ganha o nome e a cor da classe sorteada. */
export function rewardCard(
  option: RewardOption,
  index: number,
  data: RewardData,
  classes: ClassData,
): RewardCardModel {
  const reward = getReward(data, option.id);
  const classId = option.classId ?? reward.classId;
  const className = classId ? (classes.classes[classId]?.name ?? classId) : '';
  const categoryName = texts.categories[reward.category];
  return {
    index,
    key: String(index + 1),
    rewardId: reward.id,
    name: option.classId ? fillText(texts.wildcardName, { classe: className }) : reward.name,
    text: fillText(reward.text, { classe: className }),
    category: classId ? `${categoryName} · ${className}` : categoryName,
    color: (classId ? classColors[classId] : categoryColors[reward.category]) ?? '#ffffff',
    repeatable: reward.repeatable,
  };
}

/** `null` sem tela aberta. */
export function buildRewardScreenModel(
  state: Readonly<RunState>,
  data: RewardData,
  classes: ClassData,
  ticksPerSecond: number,
): RewardScreenModel | null {
  const screen = state.rewards.screen;
  if (!screen) return null;
  const total = Math.max(1, Math.round(data.chooseSeconds * ticksPerSecond));
  const cost = rewardRerollCost(data, screen);
  const queued = state.rewards.queue.length;
  return {
    title: data.waves.includes(screen.wave)
      ? fillText(texts.title, { wave: screen.wave })
      : texts.extraTitle,
    queued: queued > 0 ? fillText(texts.queued, { n: queued }) : '',
    cards: screen.options.map((option, i) => rewardCard(option, i, data, classes)),
    rerollCost: cost,
    canReroll: state.gold >= cost,
    seconds: Math.ceil(screen.ticksLeft / ticksPerSecond),
    timeLeft: Math.min(1, screen.ticksLeft / total),
  };
}

/** Assinatura das cartas e do reroll (o tempo muda a cada tick e é desenhado à parte). */
export function rewardScreenKey(model: RewardScreenModel | null): string {
  if (!model) return '-';
  return [
    model.title,
    model.queued,
    model.cards.map((c) => `${c.rewardId}:${c.name}`).join(','),
    model.rerollCost,
    model.canReroll ? 1 : 0,
  ].join('|');
}
