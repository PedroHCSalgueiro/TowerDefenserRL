/**
 * Eventos tipados emitidos pela simulação.
 *
 * Os eventos ficam num buffer durante os ticks. A renderização e a UI chamam
 * `drain()` uma vez por quadro (que pode ter rodado vários ticks). Eventos são
 * passageiros e não fazem parte do estado salvo.
 */

export interface SimEventPayloads {
  enemySpawned: { enemyId: number; enemyType: string };
  /** `towerId` é `null` quando quem matou foi o núcleo. */
  enemyKilled: { enemyId: number; enemyType: string; towerId: number | null };
  enemyReachedNexus: { enemyId: number; damage: number };
  /** `x`/`y`: posição do alvo na grade no momento do ataque. */
  nexusFired: { targetId: number; x: number; y: number };
  runLost: Record<never, never>;
  /** `x`/`y`: casa da torre. */
  towerPlaced: { towerId: number; towerType: string; x: number; y: number };
  towerFired: { towerId: number; targetId: number };
  /** Impacto de um tiro em área: ponto na grade e raio, em casas. */
  projectileExploded: { towerId: number; x: number; y: number; radius: number };
  triggerFired: { towerId: number; triggerId: string; depth: number };
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
