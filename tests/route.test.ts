import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import { Route, buildRoutes, type MutablePoint } from '../src/sim/enemies/route';
import { loadMap } from '../src/sim/grid/map';
import { smallMap } from './support/enemySim';

function at(route: Route, distance: number): MutablePoint {
  const out = { x: NaN, y: NaN };
  route.sampleInto(distance, out);
  return out;
}

describe('Route', () => {
  const { ground, air } = buildRoutes(smallMap);

  it('a rota terrestre passa pelo centro de todas as casas do caminho', () => {
    expect(ground.length).toBe(7);
    smallMap.pathCells.forEach((cell, i) => expect(at(ground, i)).toEqual(cell));
  });

  it('começa na entrada e termina no núcleo', () => {
    expect(at(ground, 0)).toEqual(smallMap.entrance);
    expect(at(ground, ground.length)).toEqual(smallMap.nexus);
    expect(at(air, 0)).toEqual(smallMap.entrance);
    expect(at(air, air.length)).toEqual(smallMap.nexus);
  });

  it('interpola dentro do trecho e vira exatamente na curva', () => {
    expect(at(ground, 1.5)).toEqual({ x: 1.5, y: 1 });
    expect(at(ground, 3)).toEqual({ x: 3, y: 1 });
    expect(at(ground, 3.5)).toEqual({ x: 3, y: 1.5 });
    expect(at(ground, 6.25)).toEqual({ x: 1.75, y: 3 });
  });

  it('distâncias fora da rota ficam presas nas pontas', () => {
    expect(at(ground, -2)).toEqual(smallMap.entrance);
    expect(at(ground, 99)).toEqual(smallMap.nexus);
  });

  it('a rota aérea é uma reta da entrada ao núcleo', () => {
    expect(air.length).toBeCloseTo(Math.sqrt(5), 12);
    const mid = at(air, air.length / 2);
    expect(mid.x).toBeCloseTo(0.5, 12);
    expect(mid.y).toBeCloseTo(2, 12);
    // Qualquer ponto fica sobre a reta y = 1 + 2x.
    const p = at(air, 0.8);
    expect(p.y).toBeCloseTo(1 + 2 * p.x, 12);
  });

  it('no mapa do jogo a rota terrestre tem uma casa por trecho', () => {
    const map = loadMap(mapData);
    expect(buildRoutes(map).ground.length).toBe(map.pathCells.length - 1);
  });

  it('rejeita rota com menos de 2 pontos ou ponto repetido', () => {
    expect(() => new Route([{ x: 0, y: 0 }])).toThrow(/2 pontos/);
    expect(
      () =>
        new Route([
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ]),
    ).toThrow(/repetido/);
  });
});
