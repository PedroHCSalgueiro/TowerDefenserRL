import { describe, expect, it } from 'vitest';
import { sortEnemiesById } from '../src/sim/enemies/order';
import type { Enemy } from '../src/sim/enemies/pool';
import { Rng } from '../src/sim/engine/rng';

const enemy = (id: number): Enemy => ({ id }) as Enemy;

describe('ordenação de inimigos por id', () => {
  it('dá o mesmo resultado que ordenar pelo comparador', () => {
    const rng = new Rng({ rngState: 42 });
    for (const size of [0, 1, 2, 7, 300, 2000]) {
      const list = Array.from({ length: size }, (_, i) => enemy(i * 3 + 1));
      rng.shuffle(list);
      const expected = [...list].sort((a, b) => a.id - b.id);
      const sorted = sortEnemiesById(list);
      expect(sorted).toBe(list); // no próprio array
      expect(sorted).toEqual(expected);
      expect(sorted.every((e, i) => e === expected[i])).toBe(true);
    }
  });

  it('lista já em ordem fica como está; ids enormes usam o comparador', () => {
    const inOrder = [enemy(1), enemy(5), enemy(9)];
    expect(sortEnemiesById(inOrder)).toEqual([enemy(1), enemy(5), enemy(9)]);
    const huge = [enemy(2 ** 40), enemy(3), enemy(2 ** 40 - 1)];
    expect(sortEnemiesById(huge).map((e) => e.id)).toEqual([3, 2 ** 40 - 1, 2 ** 40]);
  });
});
