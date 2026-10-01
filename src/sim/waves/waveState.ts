/** Parte do `RunState` que acompanha a onda em andamento. */

export interface WaveState {
  /** Há uma onda chamada que ainda não terminou. O número dela é `RunState.wave + 1`. */
  active: boolean;
  /** Tick em que a onda foi chamada (os nascimentos contam a partir dele). */
  startTick: number;
  /** Quantos inimigos da lista da onda já nasceram. */
  spawned: number;
  /** Chefões da onda mortos até agora (a vitória pede todos). */
  bossesKilled: number;
}

export function createWaveState(): WaveState {
  return { active: false, startTick: 0, spawned: 0, bossesKilled: 0 };
}

/** Estatísticas da run, para as telas de vitória e derrota. */
export interface RunStats {
  /** Todos os inimigos mortos, por qualquer autor (inclusive o núcleo). */
  kills: number;
}
