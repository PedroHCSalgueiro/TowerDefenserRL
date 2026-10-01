/** Parte do `RunState` que acompanha as ondas em andamento (empilhadas desde a T14). */

/** Uma onda chamada que ainda não fechou. */
export interface ActiveWave {
  /** Número da onda (a primeira é a 1). */
  wave: number;
  /** Tick em que a onda foi chamada (os nascimentos contam a partir dele). */
  startTick: number;
  /** Quantos inimigos da lista da onda já nasceram. */
  spawned: number;
  /** Chefões da onda mortos até agora (a vitória pede todos). */
  bossesKilled: number;
  /** Bônus da chamada antecipada, pago quando a onda fecha (0 = chamada com o mapa sem ondas). */
  earlyBonus: number;
}

export interface WaveState {
  /**
   * Ondas chamadas que ainda não fecharam, da mais antiga para a mais nova.
   * Fecham em ordem: a primeira é sempre a de número `RunState.wave + 1`.
   */
  active: ActiveWave[];
  /**
   * Multiplicador do ouro de abate deste tick, calculado depois dos
   * nascimentos pelas ondas com inimigo vivo ou por nascer.
   */
  goldMultiplier: number;
  /** Fração de ouro de abate que ainda não virou moeda, em [0, 1). */
  goldFraction: number;
}

export function createWaveState(): WaveState {
  return { active: [], goldMultiplier: 1, goldFraction: 0 };
}

/** Número da próxima onda a chamar (a primeira é a 1). */
export function nextWaveNumber(state: {
  readonly wave: number;
  readonly waves: Readonly<WaveState>;
}): number {
  return state.wave + state.waves.active.length + 1;
}

/** Estatísticas da run, para as telas de vitória e derrota. */
export interface RunStats {
  /** Todos os inimigos mortos, por qualquer autor (inclusive o núcleo). */
  kills: number;
  /** Maior cadeia da run, em gatilhos com efeito visível (T16). */
  longestChain: number;
}
