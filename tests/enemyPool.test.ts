import { describe, expect, it } from 'vitest';
import { acquireEnemy, createEnemyPool, releaseEnemy } from '../src/sim/enemies/pool';

describe('pool de inimigos', () => {
  it('pré-aloca a capacidade e entrega os slots em ordem', () => {
    const pool = createEnemyPool(3);
    expect(pool.slots).toHaveLength(3);
    expect(pool.slots.every((e) => !e.active)).toBe(true);
    expect(acquireEnemy(pool).slot).toBe(0);
    expect(acquireEnemy(pool).slot).toBe(1);
    expect(pool.activeCount).toBe(2);
  });

  it('reaproveita o mesmo objeto depois de devolvido', () => {
    const pool = createEnemyPool(2);
    const first = acquireEnemy(pool);
    acquireEnemy(pool);
    releaseEnemy(pool, first);
    expect(first.active).toBe(false);
    expect(pool.activeCount).toBe(1);

    const again = acquireEnemy(pool);
    expect(again).toBe(first);
    expect(again.active).toBe(true);
    expect(pool.slots).toHaveLength(2);
  });

  it('cresce quando esgota, sem mexer nos objetos existentes', () => {
    const pool = createEnemyPool(1);
    const a = acquireEnemy(pool);
    const b = acquireEnemy(pool);
    expect(b.slot).toBe(1);
    expect(pool.slots).toEqual([a, b]);
    expect(pool.activeCount).toBe(2);
  });

  it('devolver duas vezes é erro', () => {
    const pool = createEnemyPool(1);
    const enemy = acquireEnemy(pool);
    releaseEnemy(pool, enemy);
    expect(() => releaseEnemy(pool, enemy)).toThrow(/já foi devolvido/);
    expect(pool.free).toEqual([0]);
  });
});
