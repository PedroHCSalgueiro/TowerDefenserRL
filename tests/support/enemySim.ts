/**
 * Apoio aos testes de inimigos e núcleo: mapa pequeno e números "redondos".
 * Com 8 ticks/s e velocidade 2, cada tick anda exatamente 0,25 casa, o que
 * evita erro de ponto flutuante nas comparações.
 */

import type { EnemyData } from '../../src/sim/enemies/enemyData';
import { acquireEnemy, type Enemy } from '../../src/sim/enemies/pool';
import { Simulation } from '../../src/sim/engine/simulation';
import { loadMap } from '../../src/sim/grid/map';
import { nexusData, nexusLevel, type NexusData } from '../../src/sim/nexus/nexusData';
import { createRunState, type RunState } from '../../src/sim/state';
import { createGameSystems } from '../../src/sim/systems';

export const TPS = 8;
export const STEP = 0.25;

// Entra em (0,1), vai até (3,1), desce até (3,3) e termina no núcleo em (1,3).
// Rota terrestre: 7 casas. Rota aérea: reta de (0,1) a (1,3), √5 casas.
export const smallMap = loadMap({
  id: 'small',
  width: 5,
  height: 4,
  path: [
    { x: 0, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 },
  ],
});

export const testEnemies: EnemyData = {
  armor: { scale: 100 },
  types: {
    walker: {
      hp: 10,
      speed: 2,
      armor: 0,
      nexusDamage: 2,
      gold: 1,
      movement: 'ground',
      boss: false,
    },
    flyer: { hp: 10, speed: 2, armor: 0, nexusDamage: 1, gold: 1, movement: 'air', boss: false },
    tank: { hp: 10, speed: 2, armor: 50, nexusDamage: 3, gold: 2, movement: 'ground', boss: false },
    /** Chefão de teste (o de verdade é da T13): imune à execução. */
    titan: {
      hp: 100,
      speed: 2,
      armor: 50,
      nexusDamage: 5,
      gold: 5,
      movement: 'ground',
      boss: true,
    },
    brick: {
      hp: 1e9,
      speed: 2,
      armor: 0,
      nexusDamage: 2,
      gold: 0,
      movement: 'ground',
      boss: false,
    },
  },
};

export const testNexus: NexusData = {
  levels: nexusData.levels,
  attack: { damage: 4, cooldownSeconds: 1, range: 1.5 },
};

/** Núcleo que praticamente não alcança ninguém, para isolar o movimento. */
export const blindNexus: NexusData = {
  levels: nexusData.levels,
  attack: { damage: 4, cooldownSeconds: 1, range: 1e-6 },
};

export function makeState(seed = 'test', nexus: NexusData = testNexus): RunState {
  const state = createRunState(seed);
  const { maxHp } = nexusLevel(nexus, state.nexus.level);
  state.nexus.hp = maxHp;
  state.nexus.maxHp = maxHp;
  return state;
}

export function makeSim(
  nexus: NexusData = testNexus,
  state = makeState('test', nexus),
): Simulation {
  return new Simulation(
    state,
    createGameSystems(smallMap, { enemies: testEnemies, nexus, ticksPerSecond: TPS }),
  );
}

export function spawn(sim: Simulation, enemyType: string, count = 1): void {
  for (let i = 0; i < count; i++) sim.enqueue({ type: 'spawnEnemy', enemyType });
}

export function activeEnemies(state: Readonly<RunState>): Enemy[] {
  return state.enemies.slots.filter((e) => e.active);
}

/** Coloca um inimigo direto no estado, numa posição exata (sem passar pelo spawn). */
export function place(state: RunState, type: string, x: number, y: number, hp = 10): Enemy {
  const enemy = acquireEnemy(state.enemies);
  enemy.id = state.nextEntityId++;
  enemy.type = type;
  enemy.hp = hp;
  enemy.maxHp = hp;
  enemy.distance = 0;
  enemy.x = enemy.prevX = x;
  enemy.y = enemy.prevY = y;
  return enemy;
}
