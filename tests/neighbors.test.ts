import { describe, expect, it } from 'vitest';
import { loadMap } from '../src/sim/grid/map';
import { neighbors } from '../src/sim/grid/neighbors';

const map = loadMap({
  id: 'n',
  width: 5,
  height: 5,
  path: [
    { x: 0, y: 4 },
    { x: 4, y: 4 },
  ],
});

describe('neighbors', () => {
  it('casa do meio: 4 vizinhas na ordem fixa', () => {
    expect(neighbors(map, { x: 2, y: 2 })).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
    ]);
  });

  it('casa do meio: 8 vizinhas, lados primeiro e depois diagonais', () => {
    expect(neighbors(map, { x: 2, y: 2 }, 8)).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 1 },
    ]);
  });

  it('cantos: 2 vizinhas com 4, 3 com 8', () => {
    for (const corner of [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
    ]) {
      expect(neighbors(map, corner, 4)).toHaveLength(2);
      expect(neighbors(map, corner, 8)).toHaveLength(3);
    }
  });

  it('bordas: 3 vizinhas com 4, 5 com 8', () => {
    for (const edge of [
      { x: 2, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 2 },
    ]) {
      expect(neighbors(map, edge, 4)).toHaveLength(3);
      expect(neighbors(map, edge, 8)).toHaveLength(5);
    }
  });

  it('nunca devolve a própria casa, repetidas ou fora da grade', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        for (const mode of [4, 8] as const) {
          const result = neighbors(map, { x, y }, mode);
          const keys = new Set(result.map((c) => `${c.x},${c.y}`));
          expect(keys.size).toBe(result.length);
          expect(keys.has(`${x},${y}`)).toBe(false);
          for (const c of result) {
            expect(map.isInside(c)).toBe(true);
            expect(Math.max(Math.abs(c.x - x), Math.abs(c.y - y))).toBe(1);
          }
        }
      }
    }
  });
});
