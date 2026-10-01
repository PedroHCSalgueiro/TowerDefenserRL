import { describe, expect, it } from 'vitest';
import { triggerFxDisabled } from '../src/debug/flags';
import mapData from '../src/data/map.json';
import type { SimDebugData } from '../src/sim/debug/debugData';
import { pickTowerCells } from '../src/sim/debug/towerCells';
import { buildRoutes } from '../src/sim/enemies/route';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { createRunState, deserializeRunState, type SimCommand } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import {
  TPS,
  activeEnemies,
  blindNexus,
  makeState,
  smallMap,
  spawn,
  testEnemies,
} from './support/enemySim';
import { run, testTowers } from './support/towerSim';

const testDebug: SimDebugData = { maxSpawnPerCommand: 50 };

function smallSim(state = makeState('debug', blindNexus)): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: blindNexus,
      towers: testTowers,
      debug: testDebug,
      ticksPerSecond: TPS,
    }),
  );
}

describe('spawn de torres pelo debug', () => {
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

  it('pela fila de ações, torres reais do tipo pedido, sem repetir casa entre ações', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, towerTypes: ['arrow'], layout: 'clustered' });
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, towerTypes: ['bomb'], layout: 'clustered' });
    expect(sim.state.towers).toHaveLength(0);
    const events = run(sim, 1);
    const towers = sim.state.towers;
    expect(towers.map((t) => t.type)).toEqual(['arrow', 'arrow', 'arrow', 'bomb', 'bomb', 'bomb']);
    expect(new Set(towers.map((t) => t.id)).size).toBe(6);
    expect(new Set(towers.map((t) => smallMap.indexOf(t))).size).toBe(6);
    expect(events.filter((e) => e.type === 'towerPlaced')).toHaveLength(6);
  });

  it('tipo desconhecido não cria nada nem gasta id', () => {
    const sim = smallSim();
    const idBefore = sim.state.nextEntityId;
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, towerTypes: ['laser'], layout: 'spread' });
    run(sim, 1);
    expect(sim.state.towers).toEqual([]);
    expect(sim.state.nextEntityId).toBe(idBefore);
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

  it('tipos sorteados (sem chefão) e espalhados pela rota', () => {
    const sim = smallSim();
    sim.enqueue({ type: 'debugSpawnEnemies', count: 50, enemyType: null, layout: 'spread' });
    run(sim, 1);
    const enemies = activeEnemies(sim.state);
    const nonBoss = Object.keys(testEnemies.types).filter((id) => !testEnemies.types[id]!.boss);
    expect(new Set(enemies.map((e) => e.type))).toEqual(new Set(nonBoss));
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
      { type: 'debugSpawnTowers', count: 6, towerTypes: ['basic'], layout },
      { type: 'debugSpawnTowers', count: 4, towerTypes: ['cannon'], layout },
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
    expect(sim.state.towers).toEqual([]);
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
    const json = JSON.stringify(createRunState('v4'));
    for (const field of ['debug', 'projectiles', 'towers']) {
      const data = JSON.parse(json) as Record<string, unknown>;
      delete data[field];
      expect(() => deserializeRunState(JSON.stringify(data))).toThrow(/inválido/);
    }
  });
});

describe('chave ?fx=0 (T16)', () => {
  it('só desliga os efeitos dos gatilhos com fx=0', () => {
    expect(triggerFxDisabled('?fx=0')).toBe(true);
    expect(triggerFxDisabled('?seed=abc&fx=0')).toBe(true);
    expect(triggerFxDisabled('')).toBe(false);
    expect(triggerFxDisabled('?fx=1')).toBe(false);
  });
});
