/**
 * Parte do `RunState` que pertence ao motor de gatilhos: a fila de
 * gatilhos pendentes (que atravessa ticks e vai para o save), a ordem global
 * de disparo e os contadores do último tick (lidos pelo painel de debug).
 */

/** Um gatilho que já foi acionado ("quando" cumprido) e espera executar o "o quê". */
export interface PendingTrigger {
  /** Torre cujo gatilho vai executar (destino). */
  towerId: number;
  /** Quem causou (origem): a própria torre, a vizinha que abateu ou ativou; `null` = núcleo. */
  sourceTowerId: number | null;
  /**
   * Peso do fato: 1 normal, 2 no abate duplo (vale para as cargas). 0 = só
   * descarregar cargas guardadas (próximo tiro da própria torre com alvo).
   */
  weight: number;
  /** Profundidade na cadeia: 1 = causado por algo fora do motor (tiro normal, projétil, núcleo). */
  depth: number;
  /** Profundidade contada só neste tick (limite `maxChainDepthPerTick`). */
  tickDepth: number;
  /** Ponto do fato (onde o inimigo morreu), se houver. */
  hasPoint: boolean;
  x: number;
  y: number;
  /**
   * > 0: não é o "o quê" da torre, é a explosão de uma execução (Carrasco
   * ★3) no ponto (`x`, `y`), com este raio e `blastPercent` do dano da torre.
   * Cada explosão é uma entrada própria: conta no orçamento e na profundidade.
   */
  blastRadius: number;
  blastPercent: number;
}

export interface TriggerTickStats {
  /** Gatilhos executados no tick (`triggerFired`). */
  fired: number;
  /** Maior profundidade de cadeia executada no tick (0 = nenhuma). */
  maxDepth: number;
  /** Gatilhos que ficaram na fila para o tick seguinte. */
  deferred: number;
  /** Gatilhos descartados no tick por passar do teto da fila. */
  dropped: number;
}

export interface TriggerState {
  /** Fila FIFO dos gatilhos pendentes (sobras do tick anterior primeiro). */
  queue: PendingTrigger[];
  /** Próximo número da ordem global de disparo (`Tower.lastEffect.seq`). */
  nextSeq: number;
  lastTick: TriggerTickStats;
  /** Total de descartados na run (deve ficar em zero). */
  droppedTotal: number;
}

export function emptyTickStats(): TriggerTickStats {
  return { fired: 0, maxDepth: 0, deferred: 0, dropped: 0 };
}

export function createTriggerState(): TriggerState {
  return { queue: [], nextSeq: 1, lastTick: emptyTickStats(), droppedTotal: 0 };
}
