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
   */
  enemyKilled: {
    enemyId: number;
    enemyType: string;
    towerId: number | null;
    x: number;
    y: number;
    weight: number;
  };
  enemyReachedNexus: { enemyId: number; damage: number };
  /** `x`/`y`: posição do alvo na grade no momento do ataque. */
  nexusFired: { targetId: number; x: number; y: number };
  runLost: Record<never, never>;
  /** `x`/`y`: casa da torre. */
  towerPlaced: { towerId: number; towerType: string; x: number; y: number };
  towerFired: { towerId: number; targetId: number; shot: ShotKind };
  /** Dano em área (tiro em área ou explosão de gatilho): ponto na grade e raio, em casas. */
  areaExploded: { towerId: number; x: number; y: number; radius: number };
  /**
   * Um gatilho executou o "o quê". Destino = `towerId` (a torre do gatilho);
   * origem = `sourceTowerId` (quem causou; `null` = núcleo). `effect` é o que
   * foi executado (no "copiar", o efeito copiado). `depth` 1 = início da cadeia.
   */
  triggerFired: {
    towerId: number;
    sourceTowerId: number | null;
    when: WhenKind;
    effect: EffectKind;
    depth: number;
  };
  /** Uma torre foi ativada por gatilho de uma vizinha (origem → destino). */
  towerActivated: { towerId: number; sourceTowerId: number; depth: number };
  towersMerged: { towerId: number; stars: number };
  waveStarted: { wave: number };
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
