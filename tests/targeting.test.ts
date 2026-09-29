import { describe, expect, it } from 'vitest';
import { releaseEnemy, type Enemy } from '../src/sim/enemies/pool';
import { Rng } from '../src/sim/engine/rng';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import type { RunState } from '../src/sim/state';
import { TARGET_MODES, createTargetScores } from '../src/sim/towers/targeting';
import { makeState, testEnemies } from './support/enemySim';
import { onRoute, smallRoutes } from './support/towerSim';

// Mapa pequeno: rota terrestre de 7 casas ((0,1)→(3,1)→(3,3)→(1,3)); aérea de √5.
const { first } = createTargetScores(smallRoutes, testEnemies);

function findFirst(state: RunState, x: number, y: number, range: number): Enemy | null {
  return new SpatialIndex(1).findBest(state, x, y, range, first);
}

/** Referência: todos contra todos, menor distância que falta, empate no menor id. */
function bruteFirst(state: RunState, x: number, y: number, range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestLeft = Infinity;
  for (const e of state.enemies.slots) {
    if (!e.active || (e.x - x) ** 2 + (e.y - y) ** 2 > range * range) continue;
    const left = smallRoutes[testEnemies.types[e.type]!.movement].length - e.distance;
    if (left < bestLeft || (left === bestLeft && best !== null && e.id < best.id)) {
      best = e;
      bestLeft = left;
    }
  }
  return best;
}

describe('modo de mira "primeiro"', () => {
  it('é o único modo nesta tarefa', () => {
    expect(TARGET_MODES).toEqual(['first']);
  });

  it('nota = distância que falta até o núcleo, cada inimigo na sua rota', () => {
    const state = makeState();
    const walker = onRoute(state, 'walker', 2);
    const flyer = onRoute(state, 'flyer', 1);
    expect(first(walker, 0, 0)).toBe(5);
    expect(first(flyer, 0, 0)).toBeCloseTo(Math.sqrt(5) - 1, 12);
  });

  it('escolhe o mais avançado dentro do alcance, ignorando quem está fora', () => {
    const state = makeState();
    onRoute(state, 'walker', 1); // (1, 1): no alcance, falta 6
    const ahead = onRoute(state, 'walker', 2.5); // (2.5, 1): no alcance, falta 4,5
    onRoute(state, 'walker', 4); // (3, 2): mais avançado, mas fora do alcance
    expect(findFirst(state, 2, 0, 1.5)).toBe(ahead);
  });

  it('voador contra terrestre: vale o que falta, não o que já andou', () => {
    const state = makeState();
    const flyer = onRoute(state, 'flyer', 1.5); // falta √5 − 1,5 ≈ 0,74
    onRoute(state, 'walker', 5); // andou mais, mas falta 2
    expect(findFirst(state, 2, 2, 10)).toBe(flyer);

    const walker = onRoute(state, 'walker', 6.5); // falta 0,5
    expect(findFirst(state, 2, 2, 10)).toBe(walker);
  });

  it('empate: vence o menor id, mesmo morando num slot maior', () => {
    const state = makeState();
    const filler = onRoute(state, 'walker', 0.5); // id 1, slot 0
    const older = onRoute(state, 'walker', 2); // id 2, slot 1
    releaseEnemy(state.enemies, filler);
    const newer = onRoute(state, 'walker', 2); // id 3, slot 0
    expect(newer.slot).toBe(0);
    expect(findFirst(state, 2, 1, 2)).toBe(older);
  });

  it('a borda do alcance conta; sem ninguém no alcance, não há alvo', () => {
    const state = makeState();
    const enemy = onRoute(state, 'walker', 1); // (1, 1)
    expect(findFirst(state, 1, -0.5, 1.5)).toBe(enemy);
    expect(findFirst(state, 1, -0.5, 1.4999)).toBeNull();
    expect(findFirst(makeState(), 1, 1, 100)).toBeNull();
  });

  it('dá o mesmo resultado que a busca completa, com terrestres e voadores', () => {
    const rng = new Rng({ rngState: 99 });
    const state = makeState();
    for (let i = 0; i < 400; i++) {
      const type = rng.chance(0.3) ? 'flyer' : 'walker';
      const length = smallRoutes[testEnemies.types[type]!.movement].length;
      // Distâncias num conjunto pequeno de valores, para forçar empates.
      const e = onRoute(state, type, Math.floor(rng.nextFloat() * 8) * (length / 8));
      if (rng.chance(0.2)) releaseEnemy(state.enemies, e);
    }
    const index = new SpatialIndex(1);
    for (let q = 0; q < 300; q++) {
      const x = -1 + rng.nextFloat() * 6;
      const y = -1 + rng.nextFloat() * 5;
      const range = rng.nextFloat() * 3;
      expect(index.findBest(state, x, y, range, first)).toBe(bruteFirst(state, x, y, range));
    }
  });
});
