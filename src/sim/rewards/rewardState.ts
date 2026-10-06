/**
 * Parte do `RunState` das recompensas de escolha (T24): os bônus escolhidos,
 * a tela aberta, a fila de telas e o RNG próprio do sorteio das cartas.
 *
 * O RNG das cartas é um fluxo separado do RNG da simulação, derivado da
 * semente da run: sortear e rerolar cartas não muda a sequência da loja.
 */

import { hashSeed } from '../engine/rng';

/** Uma carta na tela. `classId` só no coringa (a classe sorteada). */
export interface RewardOption {
  id: string;
  classId: string | null;
}

/** Um bônus escolhido, na ordem da run. */
export interface TakenReward {
  id: string;
  /** Classe do coringa (`null` nos outros). */
  classId: string | null;
  /** Onda da tela em que foi escolhido. */
  wave: number;
}

export interface RewardScreen {
  /** Onda que deu a tela (no botão do debug, a última onda fechada). */
  wave: number;
  options: RewardOption[];
  /** Rerolls já feitos nesta tela (o custo do próximo depende disto). */
  rerolls: number;
  /** Ticks congelados até a simulação escolher sozinha. */
  ticksLeft: number;
}

export interface RewardsState {
  /** Estado do RNG das cartas (fluxo próprio, ver acima). */
  rngState: number;
  taken: TakenReward[];
  /** Tela aberta; com ela, a simulação fica congelada. */
  screen: RewardScreen | null;
  /** Ondas esperando a tela, na ordem em que fecharam. */
  queue: number[];
}

/** Sufixo da semente que separa o fluxo das cartas do RNG da simulação. */
const RNG_STREAM = '/recompensas';

export function createRewardsState(seed: string): RewardsState {
  return { rngState: hashSeed(seed + RNG_STREAM), taken: [], screen: null, queue: [] };
}

/** Há uma tela de recompensa aberta (a simulação está congelada)? */
export function rewardScreenOpen(state: { readonly rewards: RewardsState }): boolean {
  return state.rewards.screen !== null;
}
