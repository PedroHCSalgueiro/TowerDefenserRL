import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import mapData from '../src/data/map.json';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { patternTowerType } from '../src/sim/debug/towerCells';
import { loadMap } from '../src/sim/grid/map';
import {
  RUN_STATE_VERSION,
  deserializeRunState,
  type DebugLayout,
  type RunState,
} from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';

const map = loadMap(mapData);
const { chainScenario } = debugConfig;

/** O cenário "Cadeia (4 tipos)" do painel, no mapa e com as torres reais. */
function chainSim(layout: DebugLayout, enemies: number, seed = 'cadeia'): Simulation {
  const sim = Simulation.create(seed, createGameSystems(map));
  sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
  sim.enqueue({
    type: 'debugSpawnTowers',
    count: debugConfig.defaults.towerCount,
    towerTypes: chainScenario.towerTypes,
    layout: chainScenario.towerLayout as DebugLayout,
  });
  sim.enqueue({ type: 'debugSetStress', stress: { count: enemies, layout } });
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

describe('padrão de tipos do cenário de cadeia', () => {
  it('com 4 tipos, as 4 vizinhas de lado de uma casa têm os outros 3 tipos', () => {
    const types = ['a', 'b', 'c', 'd'];
    for (let y = -3; y < 5; y++) {
      for (let x = -3; x < 5; x++) {
        const own = patternTowerType(types, { x, y });
        const around = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ].map(([nx, ny]) => patternTowerType(types, { x: nx!, y: ny! }));
        expect(new Set(around)).toEqual(new Set(types.filter((t) => t !== own)));
      }
    }
  });

  it('um tipo só: todas iguais; lista vazia: nenhum', () => {
    expect(patternTowerType(['basic'], { x: 3, y: 7 })).toBe('basic');
    expect(patternTowerType([], { x: 0, y: 0 })).toBeNull();
  });

  it('no mapa real: 30 torres dos 4 tipos no bloco perto da entrada, todas encostadas', () => {
    const sim = chainSim('clustered', 0);
    sim.step();
    const { towers } = sim.state;
    expect(towers).toHaveLength(30);
    const count = new Map<string, number>();
    for (const t of towers) count.set(t.type, (count.get(t.type) ?? 0) + 1);
    expect([...count.keys()].sort()).toEqual([...chainScenario.towerTypes].sort());
    for (const tower of towers) {
      const neighbors = towers.filter(
        (o) => Math.abs(o.x - tower.x) + Math.abs(o.y - tower.y) === 1,
      );
      expect(neighbors.length).toBeGreaterThanOrEqual(1);
      expect(neighbors.every((o) => o.type !== tower.type)).toBe(true);
    }
  });
});

describe('cadeia real (Morteiro, Ceifador, Relé, Obelisco)', () => {
  it('os 4 gatilhos disparam, com ativações e cadeias de mais de um nível', () => {
    const sim = chainSim('clustered', 300);
    const events = steps(sim, 300);
    const typeOf = new Map(sim.state.towers.map((t) => [t.id, t.type]));
    const fired = events.filter((e) => e.type === 'triggerFired');
    const firedTypes = new Set(fired.map((e) => typeOf.get(e.towerId)));
    expect([...firedTypes].sort()).toEqual([...chainScenario.towerTypes].sort());
    expect(events.some((e) => e.type === 'towerActivated')).toBe(true);
    expect(Math.max(...fired.map((e) => e.depth))).toBeGreaterThan(2);
    expect(sim.state.triggers.droppedTotal).toBe(0);
  });

  it('determinístico: mesma semente, mesmo resultado; e o save no meio continua igual', () => {
    const a = chainSim('spread', 300, 'det');
    const b = chainSim('spread', 300, 'det');
    steps(a, 150);
    steps(b, 150);
    expect(b.serialize()).toBe(a.serialize());

    const resumed = new Simulation(deserializeRunState(a.serialize()), createGameSystems(map));
    steps(a, 150);
    steps(resumed, 150);
    expect(resumed.serialize()).toBe(a.serialize());
  });
});

describe('save', () => {
  it('recusa um save sem o estado dos gatilhos, sem o das classes ou com torre sem os campos novos', () => {
    const sim = chainSim('clustered', 10);
    steps(sim, 5);
    const good = JSON.parse(sim.serialize()) as RunState;
    expect(good.version).toBe(RUN_STATE_VERSION);
    expect(() => deserializeRunState(JSON.stringify(good))).not.toThrow();

    const noTriggers = { ...good, triggers: undefined };
    expect(() => deserializeRunState(JSON.stringify(noTriggers))).toThrow(/inválido/);

    const oldTower = { ...good, towers: [{ id: 1, type: 'basic', x: 0, y: 0, cooldownTicks: 0 }] };
    expect(() => deserializeRunState(JSON.stringify(oldTower))).toThrow(/inválido/);

    const noClasses = { ...good, classes: undefined };
    expect(() => deserializeRunState(JSON.stringify(noClasses))).toThrow(/inválido/);

    expect(() => deserializeRunState(JSON.stringify({ ...good, version: 8 }))).toThrow(/Versão/);
  });

  it('debugClear também esvazia a fila de gatilhos', () => {
    const sim = chainSim('clustered', 10);
    steps(sim, 3);
    sim.state.triggers.queue.push({
      towerId: 1,
      sourceTowerId: null,
      weight: 1,
      depth: 1,
      tickDepth: 1,
      hasPoint: false,
      x: 0,
      y: 0,
      blastRadius: 0,
      blastPercent: 0,
    });
    sim.enqueue({ type: 'debugClear' });
    sim.step();
    expect(sim.state.triggers.queue).toEqual([]);
    expect(sim.state.towers).toEqual([]);
  });
});
