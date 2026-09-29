import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import type { SimDebugData } from '../src/sim/debug/debugData';
import { createDummyTowerSystem, pickTowerCells } from '../src/sim/debug/dummyTowers';
import { buildRoutes } from '../src/sim/enemies/route';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { createProjectileSystem } from '../src/sim/projectiles/systems';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import { createRunState, deserializeRunState, type SimCommand } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import {
  TPS,
  activeEnemies,
  blindNexus,
  makeState,
  place,
  smallMap,
  spawn,
  testEnemies,
} from './support/enemySim';

function run(sim: Simulation, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

// 8 ticks/s: 2 tiros por segundo = um a cada 4 ticks; o projétil anda 0,5 casa por tick.
const testDebug: SimDebugData = {
  dummyTower: { damage: 6, shotsPerSecond: 2, range: 1.5, projectileSpeed: 4 },
  maxSpawnPerCommand: 50,
};

function smallSim(state = makeState('debug', blindNexus)): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: blindNexus,
      debug: testDebug,
      ticksPerSecond: TPS,
    }),
  );
}

/** Só torres e projéteis: os inimigos ficam parados onde foram colocados. */
function towersOnly(state = makeState()): Simulation {
  return new Simulation(state, [
    createProjectileSystem(testEnemies, TPS),
    createDummyTowerSystem(new SpatialIndex(1), testDebug.dummyTower, TPS),
  ]);
}

describe('posição das torres de teste', () => {
  // smallMap: caminho (0,1)→(3,1)→(3,3)→(1,3); 12 casas livres.
  it('clustered: as casas livres mais próximas da entrada', () => {
    expect(pickTowerCells(smallMap, new Set(), 3, 'clustered')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
    ]);
  });

  it('spread: vizinhas do caminho, distribuídas do começo ao fim', () => {
    const cells = pickTowerCells(smallMap, new Set(), 4, 'spread');
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(smallMap.canPlaceTower(cell)).toBe(true);
    }
    // A primeira fica junto da entrada e a última junto do fim do caminho.
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 0, y: 3 });
  });

  it('nunca repete casa, pula as ocupadas e para quando acabam as livres', () => {
    const occupied = new Set([smallMap.indexOf({ x: 0, y: 0 })]);
    for (const layout of ['spread', 'clustered'] as const) {
      const cells = pickTowerCells(smallMap, occupied, 100, layout);
      expect(cells).toHaveLength(11);
      const keys = cells.map((c) => smallMap.indexOf(c));
      expect(new Set(keys).size).toBe(11);
      expect(keys).not.toContain(smallMap.indexOf({ x: 0, y: 0 }));
    }
  });

  it('pela fila de ações, com ids únicos, sem repetir casa entre ações', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, layout: 'clustered' });
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, layout: 'clustered' });
    expect(sim.state.debug.towers).toHaveLength(0);
    run(sim, 1);
    const towers = sim.state.debug.towers;
    expect(towers).toHaveLength(6);
    expect(new Set(towers.map((t) => t.id)).size).toBe(6);
    expect(new Set(towers.map((t) => smallMap.indexOf(t))).size).toBe(6);
  });
});

describe('torres de teste e projéteis', () => {
  it('mira o mais próximo e acerta pelo projétil, com recarga', () => {
    const state = makeState();
    state.debug.towers.push({ id: 100, x: 0, y: 0, cooldownTicks: 0 });
    const near = place(state, 'brick', 1, 0, 1000); // distância 1
    place(state, 'brick', 0, 1.2, 1000); // distância 1,2
    place(state, 'brick', 3, 3, 1000); // fora do alcance
    const sim = towersOnly(state);

    const events = run(sim, 1);
    expect(events).toEqual([{ type: 'towerFired', tick: 1, towerId: 100, targetId: near.id }]);
    expect(state.projectiles.activeCount).toBe(1);

    run(sim, 1); // anda 0,5 casa
    expect(near.hp).toBe(1000);
    run(sim, 1); // chega
    expect(near.hp).toBe(994);
    expect(state.projectiles.activeCount).toBe(0);

    const fired = run(sim, 6).filter((e) => e.type === 'towerFired');
    expect(fired.map((e) => e.tick)).toEqual([5, 9]);
  });

  it('o dano passa por damageEnemy: armadura, morte e enemyKilled com a torre', () => {
    const state = makeState();
    state.debug.towers.push({ id: 100, x: 0, y: 0, cooldownTicks: 0 });
    const tank = place(state, 'tank', 0.5, 0, 10);
    const sim = towersOnly(state);
    run(sim, 2);
    expect(tank.hp).toBeCloseTo(10 - (6 * 100) / 150, 12);

    const walker = place(state, 'walker', 0, 0.4, 5);
    const events = run(sim, 4);
    expect(walker.active).toBe(false);
    expect(events).toContainEqual({
      type: 'enemyKilled',
      tick: expect.any(Number),
      enemyId: walker.id,
      enemyType: 'walker',
      towerId: 100,
    });
  });

  it('o projétil some se o alvo morrer antes, mesmo que o slot seja reaproveitado', () => {
    const state = makeState();
    state.debug.towers.push({ id: 100, x: 0, y: 0, cooldownTicks: 0 });
    const target = place(state, 'brick', 1.4, 0, 1000);
    const sim = towersOnly(state);
    run(sim, 1);
    expect(state.projectiles.activeCount).toBe(1);

    target.active = false;
    state.enemies.free.push(target.slot);
    state.enemies.activeCount--;
    const newcomer = place(state, 'brick', 1.4, 0, 1000);
    expect(newcomer.slot).toBe(target.slot);
    state.debug.towers[0]!.cooldownTicks = 99; // sem novos disparos

    run(sim, 5);
    expect(state.projectiles.activeCount).toBe(0);
    expect(newcomer.hp).toBe(1000);
  });

  it('sem ninguém no alcance, a torre espera pronta', () => {
    const state = makeState();
    state.debug.towers.push({ id: 100, x: 0, y: 0, cooldownTicks: 0 });
    place(state, 'brick', 4, 3, 1000);
    expect(run(towersOnly(state), 5)).toEqual([]);
    expect(state.debug.towers[0]!.cooldownTicks).toBe(0);
  });
});

describe('spawn de inimigos pelo debug', () => {
  it('N inimigos de um tipo, na entrada', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnEnemies', count: 5, enemyType: 'walker', layout: 'clustered' });
    run(sim, 1);
    const enemies = activeEnemies(sim.state);
    expect(enemies).toHaveLength(5);
    for (const e of enemies) {
      expect(e.type).toBe('walker');
      expect(e.distance).toBe(2 / TPS); // nasceu em 0 e andou um tick
    }
  });

  it('tipos sorteados e espalhados pela rota', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnEnemies', count: 50, enemyType: null, layout: 'spread' });
    run(sim, 1);
    const enemies = activeEnemies(sim.state);
    expect(new Set(enemies.map((e) => e.type))).toEqual(new Set(Object.keys(testEnemies.types)));
    const routes = buildRoutes(smallMap);
    const far = enemies.filter((e) => {
      const route = routes[testEnemies.types[e.type]!.movement];
      return e.distance > route.length / 2;
    });
    expect(far.length).toBeGreaterThan(5);
    expect(far.length).toBeLessThan(45);
  });

  it('a quantidade fica presa entre 0 e maxSpawnPerCommand', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnEnemies', count: -3, enemyType: 'brick', layout: 'clustered' });
    run(sim, 1);
    expect(sim.state.enemies.activeCount).toBe(0);
    sim.enqueue({ type: 'debugSpawnEnemies', count: 1e9, enemyType: 'brick', layout: 'clustered' });
    run(sim, 1);
    expect(sim.state.enemies.activeCount).toBe(50);
  });
});

describe('núcleo invulnerável', () => {
  it('quem chega sai do mapa sem dano; desligar volta ao normal', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    spawn(sim, 'brick');
    const events = run(sim, 28);
    expect(sim.state.nexus.hp).toBe(20);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(events.filter((e) => e.type === 'enemyReachedNexus')).toEqual([
      { type: 'enemyReachedNexus', tick: 28, enemyId: 1, damage: 0 },
    ]);

    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: false });
    spawn(sim, 'brick');
    run(sim, 28);
    expect(sim.state.nexus.hp).toBe(18);
  });

  it('a run não termina, por mais inimigos que cheguem', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({ type: 'debugSetStress', stress: { count: 40, layout: 'clustered' } });
    run(sim, 400);
    expect(sim.state.status).toBe('playing');
    expect(sim.state.nexus.hp).toBe(20);
  });
});

describe('modo estresse', () => {
  const realMap = loadMap(mapData);
  const realSystems = () => createGameSystems(realMap);

  function stressSim(layout: 'spread' | 'clustered'): Simulation {
    const sim = Simulation.create('stress', realSystems());
    const setup: SimCommand[] = [
      { type: 'debugSetNexusInvulnerable', value: true },
      { type: 'debugSpawnTowers', count: 10, layout },
      { type: 'debugSetStress', stress: { count: 200, layout } },
    ];
    setup.forEach((c) => sim.enqueue(c));
    return sim;
  }

  it.each(['spread', 'clustered'] as const)(
    'mantém N inimigos, repondo quem morre ou chega (%s)',
    (layout) => {
      const sim = stressSim(layout);
      let kills = 0;
      let arrivals = 0;
      for (let i = 0; i < 900; i++) {
        sim.step();
        const events = sim.drainEvents();
        const removed = events.filter(
          (e) => e.type === 'enemyKilled' || e.type === 'enemyReachedNexus',
        ).length;
        kills += events.filter((e) => e.type === 'enemyKilled').length;
        arrivals += events.filter((e) => e.type === 'enemyReachedNexus').length;
        // A reposição acontece no início do tick; quem saiu depois dela falta até o próximo.
        expect(sim.state.enemies.activeCount + removed).toBe(200);
      }
      expect(kills).toBeGreaterThan(50);
      expect(arrivals).toBeGreaterThan(0);
      expect(sim.state.status).toBe('playing');
    },
  );

  it('clustered: a reposição nasce na entrada; spread: ao longo da rota', () => {
    for (const layout of ['clustered', 'spread'] as const) {
      const sim = stressSim(layout);
      run(sim, 300);
      // Avança até um tick com reposição e olha só quem nasceu nele.
      const spawned = new Set<number>();
      for (let i = 0; i < 200 && spawned.size === 0; i++) {
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type === 'enemySpawned') spawned.add(e.enemyId);
        }
      }
      const fresh = activeEnemies(sim.state).filter((e) => spawned.has(e.id));
      expect(fresh.length).toBeGreaterThan(0);
      // Nasceu em 0 e andou um tick (no máximo 2 casas/s ÷ 30 ticks/s).
      const nearStart = fresh.filter((e) => e.distance < 0.1).length;
      if (layout === 'clustered') expect(nearStart).toBe(fresh.length);
      else expect(nearStart).toBeLessThan(fresh.length);
    }
  });

  it('desligar o estresse para a reposição; debugClear limpa tudo menos a invulnerabilidade', () => {
    const sim = stressSim('spread');
    run(sim, 60);
    while (sim.state.projectiles.activeCount === 0) run(sim, 1);
    sim.enqueue({ type: 'debugSetStress', stress: null });
    run(sim, 1);
    expect(sim.state.debug.stress).toBeNull();

    sim.enqueue({ type: 'debugClear' });
    run(sim, 1);
    expect(sim.state.enemies.activeCount).toBe(0);
    expect(sim.state.projectiles.activeCount).toBe(0);
    expect(sim.state.debug.towers).toEqual([]);
    expect(sim.state.debug.nexusInvulnerable).toBe(true);
  });

  it('determinístico, e salvar no meio (com projéteis no ar) dá o mesmo resultado', () => {
    const straight = stressSim('spread');
    const straightEvents = run(straight, 500);

    const other = stressSim('spread');
    expect(run(other, 500)).toEqual(straightEvents);
    expect(other.state).toEqual(straight.state);

    const first = stressSim('spread');
    const splitEvents = run(first, 230);
    expect(first.state.projectiles.activeCount).toBeGreaterThan(0);
    const restored = Simulation.restore(first.serialize(), realSystems());
    run(restored, 270, splitEvents);
    expect(restored.state).toEqual(straight.state);
    expect(splitEvents).toEqual(straightEvents);
  });
});

describe('save com o estado de debug', () => {
  it('rejeita save sem os campos novos', () => {
    const json = JSON.stringify(createRunState('v3'));
    for (const field of ['debug', 'projectiles']) {
      const data = JSON.parse(json) as Record<string, unknown>;
      delete data[field];
      expect(() => deserializeRunState(JSON.stringify(data))).toThrow(/inválido/);
    }
  });
});
