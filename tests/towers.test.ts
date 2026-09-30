import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/engine/simulation';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import type { SimCommand } from '../src/sim/state';
import { createTowerSystem } from '../src/sim/towers/systems';
import { createTargetScores } from '../src/sim/towers/targeting';
import { towerData } from '../src/sim/towers/towerData';
import { makeState, place, testEnemies } from './support/enemySim';
import { addTower, onRoute, run, smallRoutes, towerSim, towersOnly } from './support/towerSim';

// smallMap: caminho (0,1)→(3,1)→(3,3)→(1,3), núcleo em (1,3); 12 casas livres.

describe('posicionar torre (ação placeTower)', () => {
  it('entra pela fila, no início do próximo tick, e emite towerPlaced', () => {
    const sim = towerSim();
    sim.enqueue({ type: 'placeTower', towerType: 'arrow', x: 0, y: 0 });
    expect(sim.state.towers).toEqual([]);

    const events = run(sim, 1);
    const [tower] = sim.state.towers;
    expect(sim.state.towers).toHaveLength(1);
    expect(tower).toEqual({
      id: tower!.id,
      type: 'arrow',
      star: 1,
      x: 0,
      y: 0,
      cooldownTicks: 0,
      triggerCounter: 0,
      charges: 0,
      activationReadyTick: 0,
      lastEffect: null,
    });
    expect(events).toEqual([
      { type: 'towerPlaced', tick: 1, towerId: tower!.id, towerType: 'arrow', x: 0, y: 0 },
    ]);
  });

  it('recusa caminho, núcleo, fora do mapa, casa ocupada, coordenada quebrada e tipo desconhecido', () => {
    const sim = towerSim();
    const idBefore = sim.state.nextEntityId;
    const invalid: SimCommand[] = [
      { type: 'placeTower', towerType: 'arrow', x: 0, y: 1 }, // entrada
      { type: 'placeTower', towerType: 'arrow', x: 2, y: 1 }, // caminho
      { type: 'placeTower', towerType: 'arrow', x: 1, y: 3 }, // núcleo
      { type: 'placeTower', towerType: 'arrow', x: -1, y: 0 },
      { type: 'placeTower', towerType: 'arrow', x: 5, y: 0 },
      { type: 'placeTower', towerType: 'arrow', x: 0.5, y: 0 },
      { type: 'placeTower', towerType: 'arrow', x: NaN, y: 0 },
      { type: 'placeTower', towerType: 'laser', x: 1, y: 0 },
      { type: 'placeTower', towerType: 'toString', x: 1, y: 0 },
    ];
    sim.enqueue({ type: 'placeTower', towerType: 'arrow', x: 0, y: 0 });
    sim.enqueue({ type: 'placeTower', towerType: 'bomb', x: 0, y: 0 }); // ocupada no mesmo tick
    invalid.forEach((c) => sim.enqueue(c));

    const events = run(sim, 1);
    expect(sim.state.towers.map((t) => [t.type, t.x, t.y])).toEqual([['arrow', 0, 0]]);
    expect(events.filter((e) => e.type === 'towerPlaced')).toHaveLength(1);
    // Só a torre válida gastou id.
    expect(sim.state.nextEntityId).toBe(idBefore + 1);
  });
});

describe('ataque das torres', () => {
  it('mira o primeiro dentro do alcance e dispara com recarga', () => {
    const state = makeState();
    const tower = addTower(state, 'arrow', 2, 0);
    onRoute(state, 'walker', 1, 1000); // (1, 1): no alcance, mas atrás
    const ahead = onRoute(state, 'walker', 2.5, 1000); // (2.5, 1): o mais avançado no alcance
    onRoute(state, 'walker', 4, 1000); // (3, 2): mais avançado, fora do alcance
    const sim = towersOnly(state);

    const events = run(sim, 1);
    expect(events).toEqual([
      { type: 'towerFired', tick: 1, towerId: tower.id, targetId: ahead.id, shot: 'normal' },
    ]);
    expect(state.projectiles.activeCount).toBe(1);

    // Distância ≈ 1,12 casa a 0,5 casa por tick: acerta no 4º tick.
    run(sim, 2);
    expect(ahead.hp).toBe(1000);
    run(sim, 1);
    expect(ahead.hp).toBe(994);

    const fired = run(sim, 8).filter((e) => e.type === 'towerFired');
    expect(fired.map((e) => e.tick)).toEqual([5, 9]);
  });

  it('o dano passa por damageEnemy: armadura, morte e enemyKilled com a torre', () => {
    const state = makeState();
    addTower(state, 'arrow', 0, 0);
    const tank = place(state, 'tank', 0.5, 0, 10);
    const sim = towersOnly(state);
    run(sim, 2);
    expect(tank.hp).toBeCloseTo(10 - (6 * 100) / 150, 12);

    const other = makeState();
    const killer = addTower(other, 'arrow', 0, 0);
    const walker = place(other, 'walker', 0, 0.4, 5);
    const events = run(towersOnly(other), 2);
    expect(walker.active).toBe(false);
    expect(events.filter((e) => e.type === 'enemyKilled')).toEqual([
      {
        type: 'enemyKilled',
        tick: 2,
        enemyId: walker.id,
        enemyType: 'walker',
        towerId: killer.id,
        x: 0,
        y: 0.4,
        weight: 1,
      },
    ]);
  });

  it('sem ninguém no alcance, a torre espera pronta', () => {
    const state = makeState();
    addTower(state, 'arrow', 0, 0);
    place(state, 'brick', 4, 3, 1000);
    expect(run(towersOnly(state), 5)).toEqual([]);
    expect(state.towers[0]!.cooldownTicks).toBe(0);
  });

  it('a cadência vira ticks inteiros: Canhão a 0,8 tiro/s e 30 ticks/s = um tiro a cada 38 ticks', () => {
    const state = makeState();
    addTower(state, 'cannon', 0, 0);
    place(state, 'brick', 1, 0, 1e9);
    const scores = createTargetScores(smallRoutes, testEnemies);
    const sim = new Simulation(state, [
      createTowerSystem(new SpatialIndex(1), towerData, scores, 30),
    ]);
    const fired = run(sim, 80).filter((e) => e.type === 'towerFired');
    expect(fired.map((e) => e.tick)).toEqual([1, 39, 77]);
  });

  it('torres disparam na ordem em que foram posicionadas', () => {
    const state = makeState();
    const a = addTower(state, 'arrow', 1, 0);
    const b = addTower(state, 'arrow', 0, 0);
    place(state, 'brick', 0.5, 0.5, 1e9);
    const fired = run(towersOnly(state), 1).filter((e) => e.type === 'towerFired');
    expect(fired.map((e) => e.type === 'towerFired' && e.towerId)).toEqual([a.id, b.id]);
  });
});

describe('tiro em área', () => {
  it('atinge todos no raio do impacto (voadores também), em ordem de id, e ninguém fora dele', () => {
    const state = makeState();
    // Criados nesta ordem para o id não coincidir com a ordem do índice espacial.
    const flyer = place(state, 'flyer', 2.8, 1.5, 4); // 0,5 do impacto; fora do alcance da torre
    const behind = place(state, 'walker', 3.3, 1, 4); // 0,5 do impacto
    const target = onRoute(state, 'walker', 2.8, 4); // (2.8, 1): o mais avançado no alcance
    const outside = place(state, 'walker', 2.8, 0.2, 4); // 0,8 do impacto: fora do raio 0,75
    const tower = addTower(state, 'bomb', 2, 0);
    const sim = towersOnly(state);

    const events = run(sim, 4);
    expect(events[0]).toEqual({
      type: 'towerFired',
      tick: 1,
      towerId: tower.id,
      targetId: target.id,
      shot: 'normal',
    });
    const impact = events.filter((e) => e.type === 'areaExploded' || e.type === 'enemyKilled');
    const killed = (enemy: typeof target, enemyType: string, x: number, y: number) => ({
      type: 'enemyKilled',
      tick: 4,
      enemyId: enemy.id,
      enemyType,
      towerId: tower.id,
      x,
      y,
      weight: 1,
    });
    expect(impact).toEqual([
      { type: 'areaExploded', tick: 4, towerId: tower.id, x: 2.8, y: 1, radius: 0.75 },
      killed(flyer, 'flyer', 2.8, 1.5),
      killed(behind, 'walker', 3.3, 1),
      killed(target, 'walker', 2.8, 1),
    ]);
    expect(outside.hp).toBe(4);
    expect(outside.active).toBe(true);
  });

  it('a armadura vale para cada inimigo atingido', () => {
    const state = makeState();
    const target = onRoute(state, 'walker', 2.8, 100);
    const tank = place(state, 'tank', 2.8, 1.5, 100);
    addTower(state, 'bomb', 2, 0);
    run(towersOnly(state), 4);
    expect(target.hp).toBe(96);
    expect(tank.hp).toBeCloseTo(100 - (4 * 100) / 150, 12);
  });
});
