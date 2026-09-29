import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from '../src/sim/engine/rng';

function sequence(seed: string, count: number): number[] {
  const rng = new Rng({ rngState: hashSeed(seed) });
  return Array.from({ length: count }, () => rng.nextFloat());
}

describe('Rng', () => {
  it('gera a mesma sequência para a mesma semente', () => {
    expect(sequence('abc', 100)).toEqual(sequence('abc', 100));
  });

  it('gera sequências diferentes para sementes diferentes', () => {
    expect(sequence('abc', 10)).not.toEqual(sequence('abd', 10));
  });

  it('nextFloat fica em [0, 1)', () => {
    for (const value of sequence('range', 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt respeita os limites e alcança as duas pontas', () => {
    const rng = new Rng({ rngState: hashSeed('int') });
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) {
      const value = rng.nextInt(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('nextInt rejeita intervalo inválido', () => {
    const rng = new Rng({ rngState: 1 });
    expect(() => rng.nextInt(5, 4)).toThrow(RangeError);
    expect(() => rng.nextInt(0.5, 4)).toThrow(RangeError);
  });

  it('continua a mesma sequência após salvar e restaurar o estado', () => {
    const holder = { rngState: hashSeed('save') };
    const rng = new Rng(holder);
    for (let i = 0; i < 50; i++) rng.nextFloat();

    const restored = new Rng({ rngState: holder.rngState });
    const expected = Array.from({ length: 20 }, () => rng.nextFloat());
    const actual = Array.from({ length: 20 }, () => restored.nextFloat());
    expect(actual).toEqual(expected);
  });

  it('hashSeed é estável', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).toBe(0xe40c292c);
  });

  it('shuffle é determinístico e mantém os elementos', () => {
    const a = new Rng({ rngState: 42 }).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng({ rngState: 42 }).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('pick rejeita lista vazia', () => {
    expect(() => new Rng({ rngState: 1 }).pick([])).toThrow(RangeError);
  });
});
