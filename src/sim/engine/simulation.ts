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
  /**
   * Eventos emitidos neste tick até agora, em ordem. É por aqui que o motor
   * de gatilhos enxerga tiros e abates do próprio tick. Não vai para o save.
   */
  readonly tickEvents: readonly SimEvent[];
  emit(event: SimEvent): void;
  allocateId(): number;
}

/** Um sistema lê e altera o estado dentro de um tick. */
export type System = (ctx: TickContext) => void;

const frozenSafe = new WeakSet<System>();

/**
 * Marca o sistema para rodar também nos ticks congelados pela tela de
 * recompensa (T24): ações, relógio e abertura da tela, ouro e classes.
 */
export function runsWhileFrozen(system: System): System {
  frozenSafe.add(system);
  return system;
}

/**
 * Tela de recompensa aberta (T24): o tick fica congelado. O número do tick
 * não anda (os nascimentos das ondas empilhadas e as travas de ativação não
 * "atrasam") e só rodam os sistemas marcados com `runsWhileFrozen`.
 */
export function isFrozen(state: Readonly<RunState>): boolean {
  return state.rewards.screen !== null;
}

export class Simulation {
  private readonly rng: Rng;
  private readonly events = new EventBus();
  private readonly runState: RunState;
  private readonly systems: readonly System[];
  private readonly tickEvents: SimEvent[] = [];

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

  /**
   * Avança um tick. Depois da derrota ou da vitória a run fica congelada.
   * Com a tela de recompensa aberta no começo do tick, o tick é congelado
   * (ver `isFrozen`).
   */
  step(): void {
    const state = this.runState;
    if (state.status !== 'playing') return;
    const commands = state.commandQueue.splice(0);
    const frozen = isFrozen(state);
    if (!frozen) state.tick++;
    const tickEvents = this.tickEvents;
    tickEvents.length = 0;
    const ctx: TickContext = {
      state,
      rng: this.rng,
      commands,
      tickEvents,
      emit: (event) => {
        tickEvents.push(event);
        this.events.emit(event);
      },
      allocateId: () => state.nextEntityId++,
    };
    for (const system of this.systems) {
      if (frozen && !frozenSafe.has(system)) continue;
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
 * Mede quanto tempo real cada tick leva. O relógio vem de fora (`now`), para
 * a simulação continuar sem depender de tempo real: medir não muda o estado.
 */
export interface TickProfiler {
  now(): number;
  recordTick(durationMs: number): void;
}

/**
 * Liga a simulação ao relógio de passo fixo. A renderização só repassa o
 * delta de cada quadro e lê `alpha` para interpolar.
 */
export class SimulationRunner {
  readonly sim: Simulation;
  readonly clock: FixedStepClock;
  profiler: TickProfiler | null = null;
  /**
   * Pausa: nenhum tick roda e o tempo real não acumula. Fica fora do estado
   * (não vai para o save) e não muda o resultado da simulação.
   */
  paused = false;

  constructor(sim: Simulation, config: EngineConfig = engineConfig) {
    this.sim = sim;
    this.clock = new FixedStepClock(config);
  }

  /**
   * Roda os ticks devidos neste quadro e devolve os eventos emitidos. Com a
   * tela de recompensa aberta, o relógio anda na velocidade base (1x), para
   * o tempo de escolha ser o tempo real.
   */
  update(deltaMs: number): SimEvent[] {
    const speed = isFrozen(this.sim.state) ? this.clock.baseSpeed : undefined;
    const ticks = this.paused ? 0 : this.clock.advance(deltaMs, speed);
    const profiler = this.profiler;
    for (let i = 0; i < ticks; i++) {
      if (profiler) {
        const start = profiler.now();
        this.sim.step();
        profiler.recordTick(profiler.now() - start);
      } else {
        this.sim.step();
      }
    }
    return this.sim.drainEvents();
  }

  get alpha(): number {
    return this.clock.alpha;
  }
}
