import { describe, expect, it } from 'vitest';
import { Simulation, SimulationRunner, type System } from '../src/sim/engine/simulation';
import type { SimEvent } from '../src/sim/engine/events';
import { RUN_STATE_VERSION, createRunState, deserializeRunState } from '../src/sim/state';

// Sistema de teste: consome o RNG, aloca ids e reage às ações, para que o
// estado dependa da semente, do número de ticks e das ações enfileiradas.
const testSystem: System = (ctx) => {
  for (const command of ctx.commands) {
    if (command.type === 'spawnEnemy') {
      ctx.emit({
        type: 'enemySpawned',
        tick: ctx.state.tick,
        enemyId: ctx.allocateId(),
        enemyType: 'common',
      });
    }
  }
  if (ctx.rng.chance(0.3)) {
    ctx.emit({
      type: 'enemySpawned',
      tick: ctx.state.tick,
      enemyId: ctx.allocateId(),
      enemyType: 'common',
    });
  }
};

// Ações aplicadas em ticks fixos, simulando o jogador.
function runWithActions(sim: Simulation, ticks: number, events: SimEvent[] = []): void {
  for (let i = 0; i < ticks; i++) {
    if (sim.state.tick % 7 === 0) sim.enqueue({ type: 'spawnEnemy', enemyType: 'common' });
    sim.step();
    events.push(...sim.drainEvents());
  }
}

describe('Simulation', () => {
  it('mesma semente + mesmas ações = mesmo estado após N ticks', () => {
    const a = Simulation.create('seed-1', [testSystem]);
    const b = Simulation.create('seed-1', [testSystem]);
    const eventsA: SimEvent[] = [];
    const eventsB: SimEvent[] = [];
    runWithActions(a, 500, eventsA);
    runWithActions(b, 500, eventsB);

    expect(a.state.tick).toBe(500);
    expect(a.state).toEqual(b.state);
    expect(eventsA).toEqual(eventsB);
    expect(eventsA.length).toBeGreaterThan(0);
  });

  it('sementes diferentes divergem', () => {
    const a = Simulation.create('seed-1', [testSystem]);
    const b = Simulation.create('seed-2', [testSystem]);
    runWithActions(a, 200);
    runWithActions(b, 200);
    expect(a.state.rngState).not.toBe(b.state.rngState);
  });

  it('serializar e restaurar produz uma simulação idêntica', () => {
    const straight = Simulation.create('save-test', [testSystem]);
    const straightEvents: SimEvent[] = [];
    runWithActions(straight, 300, straightEvents);

    const first = Simulation.create('save-test', [testSystem]);
    const splitEvents: SimEvent[] = [];
    runWithActions(first, 120, splitEvents);
    const restored = Simulation.restore(first.serialize(), [testSystem]);
    runWithActions(restored, 180, splitEvents);

    expect(restored.state).toEqual(straight.state);
    expect(splitEvents).toEqual(straightEvents);
  });

  it('ações pendentes são salvas junto com o estado', () => {
    const a = Simulation.create('pending', [testSystem]);
    a.enqueue({ type: 'spawnEnemy', enemyType: 'fast' });
    const b = Simulation.restore(a.serialize(), [testSystem]);
    a.step();
    b.step();
    expect(b.drainEvents()).toEqual(a.drainEvents());
    expect(b.state).toEqual(a.state);
  });

  it('o JSON do estado volta idêntico', () => {
    const sim = Simulation.create('json', [testSystem]);
    runWithActions(sim, 50);
    const json = sim.serialize();
    expect(deserializeRunState(json)).toEqual(sim.state);
    expect(Simulation.restore(json).serialize()).toBe(json);
  });

  it('rejeita save com versão desconhecida ou campos inválidos', () => {
    const state = createRunState('v');
    expect(() =>
      deserializeRunState(JSON.stringify({ ...state, version: RUN_STATE_VERSION + 1 })),
    ).toThrow(/Versão/);
    expect(() => deserializeRunState(JSON.stringify({ ...state, tick: 'x' }))).toThrow(/inválido/);
    expect(() => deserializeRunState('null')).toThrow(/inválido/);
  });

  it('os eventos levam o tick em que aconteceram', () => {
    const sim = Simulation.create('ticks', [testSystem]);
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'common' });
    sim.step();
    expect(sim.drainEvents()[0]).toMatchObject({ type: 'enemySpawned', tick: 1 });
  });
});

describe('SimulationRunner', () => {
  const config = { ticksPerSecond: 30, speeds: [1, 2, 3], maxTicksPerFrame: 1000 };

  it('converte o tempo real em ticks e expõe alpha', () => {
    const runner = new SimulationRunner(Simulation.create('runner'), config);
    runner.update(1000);
    expect(runner.sim.state.tick).toBe(30);
    runner.update(20);
    expect(runner.sim.state.tick).toBe(30);
    expect(runner.alpha).toBeCloseTo(0.6);
  });

  it('o resultado não depende da velocidade nem do tamanho dos quadros', () => {
    const slow = new SimulationRunner(Simulation.create('speed', [testSystem]), config);
    const fast = new SimulationRunner(Simulation.create('speed', [testSystem]), config);
    fast.clock.setSpeed(3);

    for (let i = 0; i < 300; i++) slow.update(1000 / 60);
    for (let i = 0; i < 50; i++) fast.update(2000 / 60);

    expect(slow.sim.state.tick).toBe(150);
    expect(fast.sim.state).toEqual(slow.sim.state);
  });

  it('mede cada tick com o relógio injetado, sem mudar o resultado', () => {
    let clock = 0;
    const durations: number[] = [];
    const measured = new SimulationRunner(Simulation.create('prof', [testSystem]), config);
    measured.profiler = {
      now: () => (clock += 0.5),
      recordTick: (ms) => durations.push(ms),
    };
    const plain = new SimulationRunner(Simulation.create('prof', [testSystem]), config);

    measured.update(1000 / 10);
    plain.update(1000 / 10);
    expect(durations).toEqual([0.5, 0.5, 0.5]);
    expect(measured.sim.state).toEqual(plain.sim.state);
  });
});
