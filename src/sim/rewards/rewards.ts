/**
 * Recompensas de escolha (T24): ao fechar as ondas de `rewards.json`, o
 * jogador escolhe 1 de N bônus permanentes para a run.
 *
 * - **Fila:** cada onda com recompensa que fecha entra na fila, na ordem em
 *   que fechou (várias no mesmo tick = várias telas, uma depois da outra).
 * - **Tela:** as cartas são sorteadas quando a tela abre, pelo RNG próprio
 *   das recompensas, com chance igual entre os bônus disponíveis e sem
 *   repetir na tela. Não repetíveis já escolhidos e bônus que não podem mais
 *   ter efeito ficam de fora.
 * - **Pausa:** com a tela aberta a simulação fica congelada (`Simulation`):
 *   o tick não anda e só rodam os sistemas marcados com `runsWhileFrozen`.
 * - **Tempo:** cada tick congelado gasta um tick da tela; no zero, a
 *   simulação escolhe uma carta pelo RNG das recompensas.
 * - **Reroll:** `baseCost` + `costStep` × rerolls já feitos na tela; volta ao
 *   custo base na tela nova e reinicia o tempo. Não repete as cartas que
 *   estavam na tela quando há outras suficientes.
 *
 * Sistemas, na ordem do tick: relógio (antes das ações), tempo esgotado
 * (logo depois das ações, para a escolha do jogador valer no mesmo tick) e
 * abertura (depois do fim das ondas). Uma tela aberta só começa a contar no
 * tick seguinte, então toda tela tem o tempo inteiro.
 */

import { classData, type ClassData } from '../classes/classData';
import type { EconomyData } from '../economy/economyData';
import { economyData } from '../economy/economyData';
import { spendGold } from '../economy/gold';
import { Rng } from '../engine/rng';
import type { System, TickContext } from '../engine/simulation';
import { runsWhileFrozen } from '../engine/simulation';
import type { RunState } from '../state';
import { rewardMods } from './mods';
import { getReward, rewardData, type RewardData, type RewardDef } from './rewardData';
import type { RewardOption, RewardScreen } from './rewardState';

/** Tempo da tela, em ticks. */
export function chooseTicks(data: RewardData, ticksPerSecond: number): number {
  return Math.max(1, Math.round(data.chooseSeconds * ticksPerSecond));
}

/** Custo do próximo reroll da tela. */
export function rewardRerollCost(data: RewardData, screen: Pick<RewardScreen, 'rerolls'>): number {
  return data.reroll.baseCost + data.reroll.costStep * screen.rerolls;
}

/** Classes que ainda podem sair no coringa (sem coringa escolhido, se não for repetível). */
export function freeWildcardClasses(
  state: Pick<RunState, 'rewards'>,
  reward: RewardDef,
  classes: ClassData = classData,
): string[] {
  if (reward.repeatable) return [...classes.ids];
  const used = new Set(state.rewards.taken.filter((t) => t.id === reward.id).map((t) => t.classId));
  return classes.ids.filter((id) => !used.has(id));
}

/**
 * Bônus que podem sair agora, na ordem dos dados. Fora: não repetíveis já
 * escolhidos (o coringa, por classe), a raridade com o núcleo já no último
 * nível da tabela de chances, e o coringa sem classe livre.
 */
export function availableRewards(
  state: Pick<RunState, 'rewards' | 'nexus'>,
  data: RewardData = rewardData,
  economy: EconomyData = economyData,
  classes: ClassData = classData,
): RewardDef[] {
  const taken = new Set(state.rewards.taken.map((t) => t.id));
  return data.rewards.filter((reward) => {
    if (reward.effect.kind === 'classWildcard') {
      return freeWildcardClasses(state, reward, classes).length > 0;
    }
    if (!reward.repeatable && taken.has(reward.id)) return false;
    if (reward.effect.kind === 'shopRarityLevels') {
      return state.nexus.level < economy.shop.rarityChances.length;
    }
    return true;
  });
}

/**
 * Sorteia as cartas: embaralha os disponíveis e pega as primeiras. Com
 * `exclude` (reroll), tira essas cartas se ainda sobrarem `choices` outras.
 * O coringa sorteia a classe entre as livres.
 */
export function drawRewardOptions(
  rng: Rng,
  state: Pick<RunState, 'rewards' | 'nexus'>,
  data: RewardData = rewardData,
  economy: EconomyData = economyData,
  classes: ClassData = classData,
  exclude: readonly string[] = [],
): RewardOption[] {
  let pool = availableRewards(state, data, economy, classes);
  const fresh = pool.filter((r) => !exclude.includes(r.id));
  if (fresh.length >= data.choices) pool = fresh;
  const picked = rng.shuffle([...pool]).slice(0, data.choices);
  return picked.map((reward) => ({
    id: reward.id,
    classId:
      reward.effect.kind === 'classWildcard'
        ? rng.pick(freeWildcardClasses(state, reward, classes))
        : null,
  }));
}

/** Abre a próxima tela da fila, se não houver nenhuma aberta. */
export function openNextRewardScreen(
  ctx: TickContext,
  data: RewardData,
  economy: EconomyData,
  classes: ClassData,
  ticksPerSecond: number,
): boolean {
  const { state } = ctx;
  const rewards = state.rewards;
  if (rewards.screen !== null || rewards.queue.length === 0 || state.status !== 'playing') {
    return false;
  }
  const wave = rewards.queue.shift()!;
  const options = drawRewardOptions(new Rng(rewards), state, data, economy, classes);
  rewards.screen = { wave, options, rerolls: 0, ticksLeft: chooseTicks(data, ticksPerSecond) };
  ctx.emit({
    type: 'rewardOpened',
    tick: state.tick,
    wave,
    options: options.map((o) => ({ ...o })),
    queued: rewards.queue.length,
  });
  return true;
}

/**
 * Escolhe a carta `index` da tela: o bônus entra na run e a tela fecha. Os
 * efeitos de uma vez valem na hora (+vida com cura total, reroll grátis na
 * loja aberta); os outros são lidos dos escolhidos (`rewardMods`).
 */
export function chooseReward(
  ctx: TickContext,
  data: RewardData,
  index: number,
  auto = false,
): boolean {
  const { state } = ctx;
  const screen = state.rewards.screen;
  if (!screen || !Number.isInteger(index)) return false;
  const option = screen.options[index];
  if (!option) return false;
  state.rewards.taken.push({ id: option.id, classId: option.classId, wave: screen.wave });
  state.rewards.screen = null;
  const effect = getReward(data, option.id).effect;
  if (effect.kind === 'nexusMaxHp') {
    state.nexus.maxHp += effect.amount;
    state.nexus.hp = state.nexus.maxHp;
  } else if (effect.kind === 'freeRerollsPerShop') {
    state.shop.freeRerolls += effect.count;
  }
  ctx.emit({
    type: 'rewardChosen',
    tick: state.tick,
    wave: screen.wave,
    rewardId: option.id,
    classId: option.classId,
    auto,
  });
  return true;
}

/**
 * Troca as cartas pagando o custo atual (com o ouro infinito do debug, o
 * ouro precisa bastar, mas não diminui). Reinicia o tempo da tela.
 */
export function rerollRewards(
  ctx: TickContext,
  data: RewardData,
  economy: EconomyData,
  classes: ClassData,
  ticksPerSecond: number,
): boolean {
  const { state } = ctx;
  const screen = state.rewards.screen;
  if (!screen) return false;
  const cost = rewardRerollCost(data, screen);
  if (state.gold < cost) return false;
  if (!state.debug.infiniteGold) state.stats.rewardRerollGold += cost;
  spendGold(state, cost);
  const exclude = screen.options.map((o) => o.id);
  screen.options = drawRewardOptions(
    new Rng(state.rewards),
    state,
    data,
    economy,
    classes,
    exclude,
  );
  screen.rerolls++;
  screen.ticksLeft = chooseTicks(data, ticksPerSecond);
  ctx.emit({
    type: 'rewardRerolled',
    tick: state.tick,
    wave: screen.wave,
    cost,
    options: screen.options.map((o) => ({ ...o })),
  });
  return true;
}

/** Relógio da tela, antes das ações: cada tick congelado gasta um tick da tela. */
export function createRewardClockSystem(): System {
  return runsWhileFrozen((ctx) => {
    const screen = ctx.state.rewards.screen;
    if (screen && screen.ticksLeft > 0) screen.ticksLeft--;
  });
}

/** Tempo esgotado, logo depois das ações: a simulação escolhe uma carta pelo RNG das recompensas. */
export function createRewardTimeoutSystem(data: RewardData = rewardData): System {
  return runsWhileFrozen((ctx) => {
    const screen = ctx.state.rewards.screen;
    if (!screen || screen.ticksLeft > 0) return;
    const index = new Rng(ctx.state.rewards).nextInt(0, screen.options.length - 1);
    chooseReward(ctx, data, index, true);
  });
}

/**
 * Abertura, depois do fim das ondas: as ondas com recompensa fechadas no
 * tick (`waveEnded`, em ordem) entram na fila, e a primeira da fila abre
 * se não houver tela aberta. Roda também congelado (a fila anda depois de
 * cada escolha).
 */
export function createRewardOpenSystem(
  data: RewardData = rewardData,
  economy: EconomyData = economyData,
  classes: ClassData = classData,
  ticksPerSecond: number,
): System {
  const waves = new Set(data.waves);
  return runsWhileFrozen((ctx) => {
    const { state } = ctx;
    for (const event of ctx.tickEvents) {
      if (event.type === 'waveEnded' && waves.has(event.wave)) state.rewards.queue.push(event.wave);
    }
    openNextRewardScreen(ctx, data, economy, classes, ticksPerSecond);
  });
}

/** Ouro do bônus de cadeia: quanto a cadeia rende ao chegar a `length` gatilhos visíveis. */
export function chainGoldAt(state: Pick<RunState, 'rewards'>, length: number): number {
  const chain = rewardMods(state).chainGold;
  return chain && length > 0 && length % chain.every === 0 ? chain.gold : 0;
}
