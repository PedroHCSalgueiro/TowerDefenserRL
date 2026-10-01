/**
 * Eventos tipados emitidos pela simulação.
 *
 * Os eventos ficam num buffer durante os ticks. A renderização e a UI chamam
 * `drain()` uma vez por quadro (que pode ter rodado vários ticks). Eventos são
 * passageiros e não fazem parte do estado salvo.
 */

import type { EffectKind, WhenKind } from '../triggers/triggerData';

/** Tiro normal (recarga), de ativação (tiro extra ao ser ativada) ou extra de gatilho (disparo múltiplo). */
export type ShotKind = 'normal' | 'activated' | 'extra';

export interface SimEventPayloads {
  enemySpawned: { enemyId: number; enemyType: string };
  /**
   * `towerId` é `null` quando quem matou foi o núcleo. `x`/`y`: onde morreu.
   * `weight`: quanto vale nos contadores de abate (2 = abate duplo da execução).
   * `wave`: onda dona do inimigo (0 = sem onda).
   * `chainId`/`originTowerId`: cadeia do tiro que matou, quando o projétil
   * saiu de um gatilho (tiro de ativação ou extra); `chainId` 0 = sem cadeia.
   */
  enemyKilled: {
    enemyId: number;
    enemyType: string;
    wave: number;
    towerId: number | null;
    x: number;
    y: number;
    weight: number;
    chainId: number;
    originTowerId: number | null;
  };
  enemyReachedNexus: { enemyId: number; damage: number };
  /** O chefão chegou ao núcleo: derrota imediata (`runLost` vem depois no mesmo tick). */
  bossReachedNexus: { enemyId: number; enemyType: string };
  /** `x`/`y`: posição do alvo na grade no momento do ataque. */
  nexusFired: { targetId: number; x: number; y: number };
  runLost: Record<never, never>;
  /** `x`/`y`: casa da torre. */
  towerPlaced: { towerId: number; towerType: string; x: number; y: number };
  towerFired: { towerId: number; targetId: number; shot: ShotKind };
  /**
   * Dano em área (tiro em área ou explosão de gatilho): ponto na grade e raio,
   * em casas. `trigger`: veio de um gatilho. `damage`: soma da vida tirada.
   */
  areaExploded: {
    towerId: number;
    x: number;
    y: number;
    radius: number;
    trigger: boolean;
    damage: number;
  };
  /** Raio em cadeia de um gatilho: os pontos atingidos, na ordem dos saltos, e a vida tirada. */
  lightningStruck: { towerId: number; points: { x: number; y: number }[]; damage: number };
  /** Linha perfurante de um gatilho: da torre (`x`, `y`) até o fim da linha, e a vida tirada. */
  lineFired: { towerId: number; x: number; y: number; toX: number; toY: number; damage: number };
  /**
   * Um gatilho executou o "o quê". Destino = `towerId` (a torre do gatilho);
   * origem = `sourceTowerId` (quem causou; `null` = núcleo). `effect` é o que
   * foi executado (no "copiar", o efeito copiado). `depth` 1 = início da cadeia.
   *
   * Cadeia (T16): `chainId` e `originTowerId` (torre que começou; `null` =
   * núcleo). `visible`: o gatilho teve efeito visível (o Obelisco ganhando
   * carga sem soltar o raio e o "copiar" sem nada não têm). `chainLength`:
   * gatilhos visíveis da cadeia até agora, contando este. `copiedFromTowerId`:
   * no "copiar", a vizinha copiada.
   */
  triggerFired: {
    towerId: number;
    sourceTowerId: number | null;
    when: WhenKind;
    effect: EffectKind;
    depth: number;
    chainId: number;
    originTowerId: number | null;
    visible: boolean;
    chainLength: number;
    copiedFromTowerId: number | null;
  };
  /** Uma torre foi ativada por gatilho de uma vizinha (origem → destino). */
  towerActivated: { towerId: number; sourceTowerId: number; depth: number };
  /**
   * O nível de bônus de uma classe mudou (ligou, subiu ou desligou). Vale a
   * partir do tick seguinte. `count`: torres diferentes com a classe agora.
   */
  classLevelChanged: { classId: string; level: number; previousLevel: number; count: number };
  /**
   * O jogador comprou o slot. Sem `fused`, a torre já está no mapa
   * (`towerPlaced` vem antes). Com `fused`, a compra fundiu com uma torre do
   * mapa (`towersMerged` vem antes) e `towerId` é a sobrevivente.
   */
  towerBought: {
    towerId: number;
    towerType: string;
    slot: number;
    price: number;
    fused: boolean;
  };
  /** `refund`: ouro devolvido. */
  towerSold: { towerId: number; towerType: string; x: number; y: number; refund: number };
  /**
   * A torre foi da casa `fromX`/`fromY` para `x`/`y`. `swappedWithId`: a torre
   * que estava em `x`/`y` e foi para `fromX`/`fromY` (`null` = casa livre).
   */
  towerMoved: {
    towerId: number;
    fromX: number;
    fromY: number;
    x: number;
    y: number;
    swappedWithId: number | null;
  };
  /**
   * Mover recusado, nada mudou. `locked`: há onda ativa (torres travadas);
   * `invalid`: casa fora do mapa, no caminho ou no núcleo.
   */
  moveRefused: { towerId: number; reason: 'locked' | 'invalid' };
  /** Os slots da loja mudaram. */
  shopChanged: { reason: 'bought' | 'reroll' | 'newWave' };
  /** No máximo um por tick, com o saldo final; `delta` = saldo menos o último informado. */
  goldChanged: { gold: number; delta: number };
  /**
   * Onda fechada: `interest`, `bonus` e `earlyBonus` (chamada antecipada; 0 se
   * não houve) já somados a `gold`, nessa ordem.
   */
  waveEnded: { wave: number; interest: number; bonus: number; earlyBonus: number; gold: number };
  /**
   * Uma fusão: `towerId` (que fica, com `stars`) na casa `x`/`y`; `absorbedIds`
   * saíram do mapa. A cascata emite um por fusão, na ordem em que acontecem.
   */
  towersMerged: {
    towerId: number;
    towerType: string;
    stars: number;
    x: number;
    y: number;
    absorbedIds: number[];
  };
  /**
   * O jogador evoluiu o núcleo (`level` = nível novo). `hp`/`maxHp` já são os
   * valores depois da cura; `cost` é o ouro cobrado.
   */
  nexusEvolved: { level: number; hp: number; maxHp: number; cost: number };
  /**
   * Uma compra foi recusada sem cobrar. `limit`: a torre precisaria de casa
   * nova e o mapa já está no limite do núcleo.
   */
  buyRefused: { slot: number; reason: 'limit' };
  /**
   * A onda `wave` (a primeira é a 1) foi chamada; os inimigos dela começam a
   * nascer. `early`: chamada com outra onda ativa; `earlyBonus` é pago quando
   * ela fechar.
   */
  waveStarted: { wave: number; early: boolean; earlyBonus: number };
  /**
   * "Chamar onda" recusado: `over` = run encerrada ou sem ondas restantes. Só
   * para a onda com chefão: `active` = há onda em andamento; `enemies` = ainda
   * há inimigo vivo no mapa.
   */
  callWaveRefused: { reason: 'over' | 'active' | 'enemies' };
  /** A última onda terminou com o chefão morto (`waveEnded` vem antes). */
  runWon: { wave: number };
}

export type SimEventType = keyof SimEventPayloads;

export type SimEvent = {
  [K in SimEventType]: { type: K; tick: number } & SimEventPayloads[K];
}[SimEventType];

export type SimEventOf<K extends SimEventType> = Extract<SimEvent, { type: K }>;

type AnyHandler = (event: SimEvent) => void;

export class EventBus {
  private buffer: SimEvent[] = [];
  private readonly handlers = new Map<SimEventType, Set<AnyHandler>>();

  emit(event: SimEvent): void {
    this.buffer.push(event);
  }

  /** Assina um tipo de evento. Devolve a função que cancela a assinatura. */
  on<K extends SimEventType>(type: K, handler: (event: SimEventOf<K>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const anyHandler = handler as AnyHandler;
    set.add(anyHandler);
    return () => set.delete(anyHandler);
  }

  /** Entrega os eventos acumulados aos assinantes, em ordem, e esvazia o buffer. */
  drain(): SimEvent[] {
    const events = this.buffer;
    this.buffer = [];
    for (const event of events) {
      this.handlers.get(event.type)?.forEach((handler) => handler(event));
    }
    return events;
  }
}
