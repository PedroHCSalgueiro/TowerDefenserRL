import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { createGameSystems } from '../src/sim/systems';
import { STEP, activeEnemies, blindNexus, makeSim, smallMap, spawn } from './support/enemySim';

function run(sim: Simulation, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('spawn de inimigos', () => {
  it('spawnEnemy pela fila cria o inimigo na entrada, no tick seguinte', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'walker');
    expect(activeEnemies(sim.state)).toHaveLength(0);

    const events = run(sim, 1);
    const [enemy] = activeEnemies(sim.state);
    expect(enemy).toMatchObject({ type: 'walker', hp: 10, maxHp: 10 });
    expect(events).toEqual([
      { type: 'enemySpawned', tick: 1, enemyId: enemy!.id, enemyType: 'walker' },
    ]);
    // Já anda no tick em que nasce: a interpolação parte da entrada.
    expect({ x: enemy!.prevX, y: enemy!.prevY }).toEqual(smallMap.entrance);
    expect(enemy!.distance).toBe(STEP);
  });

  it('tipo desconhecido é erro', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'dragon');
    expect(() => sim.step()).toThrow(/desconhecido/);
  });

  it('cada inimigo recebe um id novo, mesmo reaproveitando o slot', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'flyer');
    run(sim, 1);
    const first = activeEnemies(sim.state)[0]!;
    const firstId = first.id;
    run(sim, 20); // o voador chega ao núcleo e volta para o pool
    expect(activeEnemies(sim.state)).toHaveLength(0);

    spawn(sim, 'walker');
    run(sim, 1);
    const second = activeEnemies(sim.state)[0]!;
    expect(second).toBe(first);
    expect(second.id).not.toBe(firstId);
    expect({ x: second.prevX, y: second.prevY }).toEqual(smallMap.entrance);
  });
});

describe('movimento', () => {
  it('anda speed / ticksPerSecond casas por tick ao longo do caminho', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'walker');
    run(sim, 4);
    const enemy = activeEnemies(sim.state)[0]!;
    expect(enemy.distance).toBe(4 * STEP);
    expect({ x: enemy.x, y: enemy.y }).toEqual({ x: 1, y: 1 });

    run(sim, 8); // distância 3: exatamente na curva
    expect({ x: enemy.x, y: enemy.y }).toEqual({ x: 3, y: 1 });
    run(sim, 2); // distância 3,5: já descendo
    expect({ x: enemy.x, y: enemy.y }).toEqual({ x: 3, y: 1.5 });
  });

  it('guarda a posição do tick anterior para interpolar', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'walker');
    run(sim, 13);
    const enemy = activeEnemies(sim.state)[0]!;
    const before = { x: enemy.x, y: enemy.y };
    run(sim, 1);
    expect({ x: enemy.prevX, y: enemy.prevY }).toEqual(before);
    expect({ x: enemy.x, y: enemy.y }).toEqual({ x: 3, y: 1.5 });
  });

  it('o rápido anda mais que o comum no mesmo tempo (dados do jogo)', () => {
    const map = loadMap(mapData);
    const sim = Simulation.create('speed', createGameSystems(map));
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'common' });
    sim.enqueue({ type: 'spawnEnemy', enemyType: 'fast' });
    run(sim, 30);
    const [common, fast] = activeEnemies(sim.state);
    expect(common!.distance).toBeCloseTo(1, 9); // 1 casa/s
    expect(fast!.distance).toBeCloseTo(2, 9); // 2 casas/s
  });

  it('o voador vai em linha reta e chega antes do terrestre', () => {
    const sim = makeSim(blindNexus);
    spawn(sim, 'walker');
    spawn(sim, 'flyer');
    const events = run(sim, 4);
    const flyer = activeEnemies(sim.state).find((e) => e.type === 'flyer')!;
    expect(flyer.y).toBeCloseTo(1 + 2 * flyer.x, 12);
    expect(flyer.distance).toBe(1);

    run(sim, 30, events);
    const arrivals = events.filter((e) => e.type === 'enemyReachedNexus');
    // Voador: √5 casas → tick 9. Terrestre: 7 casas → tick 28.
    expect(arrivals.map((e) => e.tick)).toEqual([9, 28]);
  });
});

describe('determinismo com inimigos', () => {
  // Spawns em ticks fixos, com os dados e o mapa reais do jogo.
  const types = ['common', 'fast', 'armored', 'flying'];
  function play(sim: Simulation, ticks: number, events: SimEvent[]): void {
    for (let i = 0; i < ticks; i++) {
      if (sim.state.tick % 9 === 0) {
        sim.enqueue({ type: 'spawnEnemy', enemyType: types[(sim.state.tick / 9) % 4]! });
      }
      sim.step();
      events.push(...sim.drainEvents());
    }
  }
  const systems = () => createGameSystems(loadMap(mapData));

  it('mesma semente + mesmas ações = mesmo estado e mesmos eventos', () => {
    const a = Simulation.create('det', systems());
    const b = Simulation.create('det', systems());
    const eventsA: SimEvent[] = [];
    const eventsB: SimEvent[] = [];
    play(a, 1500, eventsA);
    play(b, 1500, eventsB);
    expect(a.state).toEqual(b.state);
    expect(eventsA).toEqual(eventsB);
    expect(eventsA.some((e) => e.type === 'nexusFired')).toBe(true);
    expect(eventsA.some((e) => e.type === 'enemyReachedNexus')).toBe(true);
  });

  it('salvar no meio (com inimigos no mapa) e restaurar dá o mesmo resultado', () => {
    const straight = Simulation.create('save', systems());
    const straightEvents: SimEvent[] = [];
    play(straight, 900, straightEvents);

    const first = Simulation.create('save', systems());
    const splitEvents: SimEvent[] = [];
    play(first, 400, splitEvents);
    expect(first.state.enemies.activeCount).toBeGreaterThan(0);
    const restored = Simulation.restore(first.serialize(), systems());
    play(restored, 500, splitEvents);

    expect(restored.state).toEqual(straight.state);
    expect(splitEvents).toEqual(straightEvents);
  });
});
