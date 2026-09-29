/**
 * Núcleo da simulação: avança o estado um tick por vez, aplicando as ações
 * enfileiradas e rodando os sistemas em ordem fixa.
 */

import engineConfig from '../../data/engine.json';
import {
  createRunState,
  deserializeRunState,
  serializeRunState,
  type RunState,
  type SimCommand,
} from '../state';
import { FixedStepClock, type EngineConfig } from './clock';
import { EventBus, type SimEvent, type SimEventOf, type SimEventType } from './events';
import { Rng } from './rng';

export interface TickContext {
  readonly state: RunState;
  readonly rng: Rng;
  /** Ações aplicadas neste tick, na ordem em que foram enfileiradas. */
  readonly commands: readonly SimCommand[];
  emit(event: SimEvent): void;
  allocateId(): number;
}

/** Um sistema lê e altera o estado dentro de um tick. */
export type System = (ctx: TickContext) => void;

export class Simulation {
  private readonly rng: Rng;
  private readonly events = new EventBus();
  private readonly runState: RunState;
  private readonly systems: readonly System[];

  constructor(runState: RunState, systems: readonly System[] = []) {
    this.runState = runState;
    this.systems = systems;
    this.rng = new Rng(runState);
  }

  static create(seed: string, systems: readonly System[] = []): Simulation {
    return new Simulation(createRunState(seed), systems);
  }

  static restore(json: string, systems: readonly System[] = []): Simulation {
    return new Simulation(deserializeRunState(json), systems);
  }

  get state(): Readonly<RunState> {
    return this.runState;
  }

  enqueue(command: SimCommand): void {
    this.runState.commandQueue.push(command);
  }

  step(): void {
    const state = this.runState;
    const commands = state.commandQueue.splice(0);
    state.tick++;
    const ctx: TickContext = {
      state,
      rng: this.rng,
      commands,
      emit: (event) => this.events.emit(event),
      allocateId: () => state.nextEntityId++,
    };
    for (const system of this.systems) {
      system(ctx);
    }
  }

  drainEvents(): SimEvent[] {
    return this.events.drain();
  }

  on<K extends SimEventType>(type: K, handler: (event: SimEventOf<K>) => void): () => void {
    return this.events.on(type, handler);
  }

  serialize(): string {
    return serializeRunState(this.runState);
  }
}

/**
 * Liga a simulação ao relógio de passo fixo. A renderização só repassa o
 * delta de cada quadro e lê `alpha` para interpolar.
 */
export class SimulationRunner {
  readonly sim: Simulation;
  readonly clock: FixedStepClock;

  constructor(sim: Simulation, config: EngineConfig = engineConfig) {
    this.sim = sim;
    this.clock = new FixedStepClock(config);
  }

  /** Roda os ticks devidos neste quadro e devolve os eventos emitidos. */
  update(deltaMs: number): SimEvent[] {
    const ticks = this.clock.advance(deltaMs);
    for (let i = 0; i < ticks; i++) {
      this.sim.step();
    }
    return this.sim.drainEvents();
  }

  get alpha(): number {
    return this.clock.alpha;
  }
}
