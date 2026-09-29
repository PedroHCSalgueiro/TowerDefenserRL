import { describe, expect, it } from 'vitest';
import { releaseEnemy, type Enemy } from '../src/sim/enemies/pool';
import { Rng } from '../src/sim/engine/rng';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import { makeState, place } from './support/enemySim';
import type { RunState } from '../src/sim/state';

/** Referência: testa todos contra todos, com o mesmo critério de desempate. */
function bruteNearest(state: RunState, x: number, y: number, range: number): Enemy | null {
  let best: Enemy | null = null;
  let bestSq = Infinity;
  for (const e of state.enemies.slots) {
    if (!e.active) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d > range * range) continue;
    if (d < bestSq || (d === bestSq && best !== null && e.id < best.id)) {
      best = e;
      bestSq = d;
    }
  }
  return best;
}

describe('SpatialIndex', () => {
  it('sem inimigos, não acha ninguém', () => {
    const index = new SpatialIndex(1);
    expect(index.findNearest(makeState(), 0, 0, 100)).toBeNull();
  });

  it('a borda do alcance conta e o empate vai para o menor id', () => {
    const state = makeState();
    const gone = place(state, 'walker', 9, 9); // id 1, slot 0
    const older = place(state, 'walker', 3, 0); // id 2: distância 3
    releaseEnemy(state.enemies, gone);
    place(state, 'walker', 0, 3); // id 3, slot 0: também distância 3
    const index = new SpatialIndex(1);
    expect(index.findNearest(state, 0, 0, 3)).toBe(older);
    expect(index.findNearest(state, 0, 0, 2.999)).toBeNull();
  });

  it('ignora inimigos que morreram depois da montagem', () => {
    const state = makeState();
    const a = place(state, 'walker', 1, 0);
    const b = place(state, 'walker', 2, 0);
    const index = new SpatialIndex(1);
    expect(index.findNearest(state, 0, 0, 5)).toBe(a);
    releaseEnemy(state.enemies, a);
    expect(index.findNearest(state, 0, 0, 5)).toBe(b);
  });

  it('remonta a cada tick com as posições novas', () => {
    const state = makeState();
    const a = place(state, 'walker', 1, 0);
    const b = place(state, 'walker', 5, 0);
    const index = new SpatialIndex(1);
    expect(index.findNearest(state, 5, 0, 1)).toBe(b);
    a.x = 5.5;
    b.x = 20;
    state.tick++;
    expect(index.findNearest(state, 5, 0, 1)).toBe(a);
  });

  it.each([
    ['espalhados', 0, 14, 0.5],
    ['agrupados', 0.2, 0.4, 1],
    ['empilhados na mesma posição', 3, 3, 0.25],
  ])('dá o mesmo resultado que a busca completa (%s)', (_name, min, max, cellSize) => {
    const rng = new Rng({ rngState: 1234 });
    const state = makeState();
    state.enemies.slots.length = 0;
    state.enemies.free.length = 0;
    const between = (lo: number, hi: number) => lo + rng.nextFloat() * (hi - lo);
    for (let i = 0; i < 600; i++) {
      const e = place(state, 'walker', between(min, max), between(min, max));
      if (rng.chance(0.2)) releaseEnemy(state.enemies, e);
    }
    const index = new SpatialIndex(cellSize);
    for (let q = 0; q < 400; q++) {
      const x = between(-3, 17);
      const y = between(-3, 17);
      const range = between(0, 5);
      expect(index.findNearest(state, x, y, range)).toBe(bruteNearest(state, x, y, range));
    }
  });
});
