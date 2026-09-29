/**
 * Apoio aos testes de torres e projéteis, no mapa pequeno de `enemySim` e
 * com números "redondos": a 8 ticks/s, 2 tiros por segundo = um a cada 4
 * ticks, e o projétil a 4 casas/s anda 0,5 casa por tick.
 */

import type { Enemy } from '../../src/sim/enemies/pool';
import { buildRoutes } from '../../src/sim/enemies/route';
import type { SimEvent } from '../../src/sim/engine/events';
import { Simulation, type System } from '../../src/sim/engine/simulation';
import { createProjectileSystem } from '../../src/sim/projectiles/systems';
import { SpatialIndex } from '../../src/sim/spatial/spatialIndex';
import type { RunState } from '../../src/sim/state';
import { createGameSystems } from '../../src/sim/systems';
import type { Tower } from '../../src/sim/towers/placement';
import { createTowerSystem } from '../../src/sim/towers/systems';
import { createTargetScores } from '../../src/sim/towers/targeting';
import type { TowerData } from '../../src/sim/towers/towerData';
import { TPS, blindNexus, makeState, place, smallMap, testEnemies } from './enemySim';

export const testTowers: TowerData = {
  projectileRetargetRadius: 1,
  types: {
    arrow: {
      name: 'Flecha',
      classes: ['mechanical', 'arcane'],
      damage: 6,
      shotsPerSecond: 2,
      range: 1.5,
      projectileSpeed: 4,
      shot: { kind: 'single' },
      targetMode: 'first',
      trigger: null,
    },
    bomb: {
      name: 'Bomba',
      classes: ['artillery', 'shadow'],
      damage: 4,
      shotsPerSecond: 1,
      range: 1.5,
      projectileSpeed: 4,
      shot: { kind: 'area', radius: 0.75 },
      targetMode: 'first',
      trigger: null,
    },
  },
};

/** Rotas do mapa pequeno: terrestre com 7 casas, aérea com √5. */
export const smallRoutes = buildRoutes(smallMap);

export function run(sim: Simulation, ticks: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Coloca um inimigo a `distance` casas do início da rota do seu tipo. */
export function onRoute(state: RunState, type: string, distance: number, hp = 10): Enemy {
  const enemy = place(state, type, 0, 0, hp);
  enemy.distance = distance;
  smallRoutes[testEnemies.types[type]!.movement].sampleInto(distance, enemy);
  enemy.prevX = enemy.x;
  enemy.prevY = enemy.y;
  return enemy;
}

/** Coloca uma torre direto no estado, sem passar pela ação. */
export function addTower(state: RunState, type: string, x: number, y: number): Tower {
  const tower: Tower = { id: state.nextEntityId++, type, x, y, cooldownTicks: 0 };
  state.towers.push(tower);
  return tower;
}

/**
 * Só projéteis e torres: os inimigos ficam parados onde foram colocados.
 * `before` roda antes dos projéteis (para simular outra fonte de dano).
 */
export function towersOnly(
  state = makeState(),
  towers = testTowers,
  tps = TPS,
  before: System[] = [],
): Simulation {
  const index = new SpatialIndex(1);
  return new Simulation(state, [
    ...before,
    createProjectileSystem(testEnemies, index, towers.projectileRetargetRadius, tps),
    createTowerSystem(index, towers, createTargetScores(smallRoutes, testEnemies), tps),
  ]);
}

/** Partida completa no mapa pequeno, com as torres de teste e o núcleo cego. */
export function towerSim(state = makeState('towers', blindNexus)): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, {
      enemies: testEnemies,
      nexus: blindNexus,
      towers: testTowers,
      ticksPerSecond: TPS,
    }),
  );
}
