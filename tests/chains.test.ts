import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import mapData from '../src/data/map.json';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { deserializeRunState, type DebugLayout, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import type { Tower } from '../src/sim/towers/placement';
import { makeState, place } from './support/enemySim';
import { addTower, run } from './support/towerSim';
import { factsAt, killFact, ofType, triggerData, triggerSim } from './support/triggerSim';

/** Torre que não dispara por conta própria (só por ativação ou gatilho). */
function idle(tower: Tower): Tower {
  tower.cooldownTicks = 1e6;
  return tower;
}

function activationFact(towerId: number, sourceTowerId: number) {
  return { type: 'towerActivated', tick: 0, towerId, sourceTowerId, depth: 1 } as const;
}

/** (cadeia, origem, comprimento) de cada `triggerFired`. */
function chainsOf(events: SimEvent[]): [number, number | null, number][] {
  return ofType(events, 'triggerFired').map((e) => [e.chainId, e.originTowerId, e.chainLength]);
}

describe('marcação de cadeia na fila', () => {
  it('cada fato de fora do motor abre uma cadeia, com ids em ordem; um fato para várias torres é uma cadeia só', () => {
    const state = makeState();
    const a = idle(addTower(state, 'bang', 0, 0));
    const b = idle(addTower(state, 'bang', 3, 0));
    // Dois ceifadores ouvem a mesma morte: uma cadeia, duas entradas.
    const r1 = idle(addTower(state, 'reaper', 0, 3));
    const r2 = idle(addTower(state, 'reaper', 1, 3));
    place(state, 'brick', 0.5, 0.5, 1e9);
    place(state, 'brick', 3, 0.5, 1e9);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [activationFact(a.id, 50), activationFact(b.id, 60), killFact(0.5, 3, 70)]),
    ]);
    const events = run(sim, 1);
    expect(
      ofType(events, 'triggerFired').map((e) => [e.towerId, e.chainId, e.originTowerId]),
    ).toEqual([
      [a.id, 1, 50],
      [b.id, 2, 60],
      [r1.id, 3, 70],
      [r2.id, 3, 70],
    ]);
    expect(chainsOf(events).map((c) => c[2])).toEqual([1, 1, 1, 2]);
    expect(state.triggers.nextChainId).toBe(4);
  });

  it('fato que não põe nada na fila não gasta id de cadeia', () => {
    const state = makeState();
    const a = idle(addTower(state, 'bang', 0, 0));
    place(state, 'brick', 0.5, 0.5, 1e9);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [killFact(9, 9, 99), activationFact(a.id, 50)]),
    ]);
    expect(chainsOf(run(sim, 1))).toEqual([[1, 50, 1]]);
  });

  it('cadeia que atravessa ticks (fila adiada): mesmo id e origem, contagem continua; sai da lista no fim', () => {
    const state = makeState();
    const towers = Array.from({ length: 6 }, (_, x) => idle(addTower(state, 'echo', x, 0)));
    towers[0]!.activationReadyTick = 1000;
    const sim = triggerSim(state, triggerData({ maxChainDepthPerTick: 2 }), [
      factsAt(1, [activationFact(towers[0]!.id, 77)]),
    ]);
    const first = run(sim, 1);
    expect(chainsOf(first)).toEqual([
      [1, 77, 1],
      [1, 77, 2],
    ]);
    expect(state.triggers.queue.map((e) => [e.chainId, e.originTowerId])).toEqual([[1, 77]]);
    expect(state.triggers.chains).toEqual([{ id: 1, originTowerId: 77, length: 2 }]);
    const rest = run(sim, 3);
    expect(chainsOf(rest)).toEqual([
      [1, 77, 3],
      [1, 77, 4],
      [1, 77, 5],
      [1, 77, 6],
    ]);
    expect(state.triggers.chains).toEqual([]);
    expect(state.stats.longestChain).toBe(6);
  });
});

describe('projétil carrega a cadeia', () => {
  /** Eco (0,0) ativa a Flecha (1,0), cujo tiro de ativação mata; o Ceifador (2,0) explode. */
  function relayKill(): {
    state: RunState;
    sim: Simulation;
    echo: Tower;
    arrow: Tower;
    reaper: Tower;
  } {
    const state = makeState();
    const echo = idle(addTower(state, 'echo', 0, 0));
    const arrow = idle(addTower(state, 'arrow', 1, 0));
    const reaper = idle(addTower(state, 'reaper', 2, 0));
    place(state, 'walker', 1, 1, 6);
    place(state, 'brick', 1.5, 1, 1e9); // recebe a explosão do Ceifador
    const sim = triggerSim(state, triggerData(), [factsAt(1, [activationFact(echo.id, 40)])]);
    return { state, sim, echo, arrow, reaper };
  }

  it('a morte pelo tiro de ativação continua a cadeia que disparou o tiro', () => {
    const { state, sim, echo, arrow, reaper } = relayKill();
    const first = run(sim, 1);
    expect(chainsOf(first)).toEqual([[1, 40, 1]]);
    const shot = state.projectiles.slots.find((p) => p.active)!;
    expect(shot).toMatchObject({ sourceId: arrow.id, chainId: 1, originTowerId: 40 });
    // Fila vazia, mas o projétil no ar mantém a cadeia viva.
    expect(state.triggers.queue).toEqual([]);
    expect(state.triggers.chains).toEqual([{ id: 1, originTowerId: 40, length: 1 }]);

    const later = run(sim, 20);
    expect(ofType(later, 'enemyKilled')[0]).toMatchObject({
      towerId: arrow.id,
      chainId: 1,
      originTowerId: 40,
    });
    expect(ofType(later, 'triggerFired').map((e) => [e.towerId, e.chainId, e.chainLength])).toEqual(
      [[reaper.id, 1, 2]],
    );
    expect(state.triggers.chains).toEqual([]);
    expect(state.stats.longestChain).toBe(2);
    void echo;
  });

  it('a morte por tiro normal abre uma cadeia nova, com origem em quem matou', () => {
    const state = makeState();
    const arrow = addTower(state, 'arrow', 1, 0);
    const reaper = idle(addTower(state, 'reaper', 2, 0));
    place(state, 'walker', 1, 1, 6);
    const events = run(triggerSim(state), 20);
    expect(ofType(events, 'enemyKilled')[0]).toMatchObject({ chainId: 0, originTowerId: null });
    expect(
      ofType(events, 'triggerFired').map((e) => [e.towerId, e.chainId, e.originTowerId]),
    ).toEqual([[reaper.id, 1, arrow.id]]);
  });

  it('save com o projétil da cadeia no ar continua igual', () => {
    const original = relayKill();
    run(original.sim, 1);
    const saved = original.sim.serialize();
    const restored = Simulation.restore(saved).state as RunState;
    expect(restored.projectiles.slots.some((p) => p.active && p.chainId === 1)).toBe(true);
    const resumed = triggerSim(restored, triggerData());
    expect(run(resumed, 20)).toEqual(run(original.sim, 20));
    expect(resumed.serialize()).toBe(original.sim.serialize());
  });
});

describe('o "x7" conta só gatilhos com efeito visível', () => {
  it('Obelisco ganhando carga sem soltar o raio não conta; soltar conta', () => {
    const state = makeState();
    const arrow = idle(addTower(state, 'arrow', 0, 0));
    const obelisk = idle(addTower(state, 'obelisk', 1, 0));
    place(state, 'brick', 1, 1, 1e9);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [killFact(0, 1, arrow.id), killFact(0, 1, arrow.id), killFact(0, 1, arrow.id)]),
    ]);
    const fired = ofType(run(sim, 1), 'triggerFired');
    expect(fired.map((e) => [e.towerId, e.chainId, e.visible, e.chainLength])).toEqual([
      [obelisk.id, 1, false, 0],
      [obelisk.id, 2, false, 0],
      [obelisk.id, 3, true, 1],
    ]);
    // O painel F2 continua contando todos.
    expect(state.triggers.lastTick.fired).toBe(3);
  });

  it('copiar sem nada para copiar não conta; copiar conta e diz de quem copiou', () => {
    const state = makeState();
    const source = idle(addTower(state, 'bang', 0, 0));
    const mimic = idle(addTower(state, 'mimicOnActivate', 1, 0));
    place(state, 'brick', 1, 1, 1e9);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [activationFact(mimic.id, 50)]),
      factsAt(2, [activationFact(source.id, 50), activationFact(mimic.id, 50)]),
    ]);
    const first = ofType(run(sim, 1), 'triggerFired');
    expect(first.map((e) => [e.visible, e.chainLength, e.copiedFromTowerId])).toEqual([
      [false, 0, null],
    ]);
    const second = ofType(run(sim, 1), 'triggerFired');
    expect(second.map((e) => [e.towerId, e.visible, e.copiedFromTowerId])).toEqual([
      [source.id, true, null],
      [mimic.id, true, source.id],
    ]);
  });
});

describe('maior cadeia da run (stats)', () => {
  it('guarda o máximo entre cadeias e começa em zero', () => {
    const state = makeState();
    expect(state.stats.longestChain).toBe(0);
    const a = idle(addTower(state, 'echo', 0, 0));
    idle(addTower(state, 'echo', 1, 0));
    idle(addTower(state, 'echo', 2, 0));
    const lone = idle(addTower(state, 'bang', 5, 5));
    place(state, 'brick', 5, 5.5, 1e9);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [activationFact(a.id, 90)]),
      factsAt(40, [activationFact(lone.id, 91)]),
    ]);
    run(sim, 1);
    const longest = state.stats.longestChain;
    expect(longest).toBeGreaterThanOrEqual(3);
    run(sim, 40);
    expect(state.stats.longestChain).toBe(longest);
  });
});

describe('cenário real "Cadeia (8 tipos)" ★3', () => {
  const map = loadMap(mapData);
  const scenario = debugConfig.fullScenario;

  function fullSim(seed: string): Simulation {
    const sim = Simulation.create(seed, createGameSystems(map));
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: debugConfig.defaults.towerCount,
      towerTypes: scenario.towerTypes,
      layout: scenario.towerLayout as DebugLayout,
      star: 3,
    });
    sim.enqueue({ type: 'debugSetStress', stress: { count: 300, layout: 'spread' } });
    return sim;
  }

  function steps(sim: Simulation, ticks: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    return events;
  }

  it('ids determinísticos, cadeias de mais de 3 e save no meio continua igual', () => {
    const a = fullSim('t16');
    const b = fullSim('t16');
    const eventsA = steps(a, 200);
    steps(b, 200);
    expect(b.serialize()).toBe(a.serialize());

    const fired = ofType(eventsA, 'triggerFired');
    expect(Math.max(...fired.map((e) => e.chainLength))).toBe(a.state.stats.longestChain);
    expect(a.state.stats.longestChain).toBeGreaterThan(3);
    // Ids crescem na ordem em que as cadeias nascem.
    const firstSeen: number[] = [];
    for (const e of fired) if (!firstSeen.includes(e.chainId)) firstSeen.push(e.chainId);
    expect(firstSeen).toEqual([...firstSeen].sort((x, y) => x - y));

    const resumed = new Simulation(deserializeRunState(a.serialize()), createGameSystems(map));
    steps(a, 150);
    steps(resumed, 150);
    expect(resumed.serialize()).toBe(a.serialize());
  });
});
