import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import { loadMap, type MapData } from '../src/sim/grid/map';

// Mapa pequeno: entra em (0,1), desce em (3,1) até (3,3) e termina em (1,3).
const small: MapData = {
  id: 'small',
  width: 5,
  height: 4,
  path: [
    { x: 0, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 },
  ],
};

describe('loadMap', () => {
  it('expande os pontos de virada em casas contíguas e em ordem', () => {
    const map = loadMap(small);
    expect(map.pathCells).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ]);
    expect(map.entrance).toEqual({ x: 0, y: 1 });
    expect(map.nexus).toEqual({ x: 1, y: 3 });
  });

  it('o map.json do jogo carrega com caminho contíguo da entrada ao núcleo', () => {
    const map = loadMap(mapData);
    const cells = map.pathCells;
    expect(cells[0]).toEqual(map.entrance);
    expect(cells[cells.length - 1]).toEqual(map.nexus);
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }
  });

  it('rejeita ponto fora da grade', () => {
    const bad = {
      ...small,
      path: [
        { x: 0, y: 1 },
        { x: 5, y: 1 },
      ],
    };
    expect(() => loadMap(bad)).toThrow(/fora da grade/);
    const negative = {
      ...small,
      path: [
        { x: -1, y: 1 },
        { x: 2, y: 1 },
      ],
    };
    expect(() => loadMap(negative)).toThrow(/fora da grade/);
  });

  it('rejeita trecho diagonal', () => {
    const bad = {
      ...small,
      path: [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
      ],
    };
    expect(() => loadMap(bad)).toThrow(/diagonal/);
  });

  it('rejeita trecho de tamanho zero', () => {
    const bad = {
      ...small,
      path: [
        { x: 0, y: 1 },
        { x: 0, y: 1 },
        { x: 2, y: 1 },
      ],
    };
    expect(() => loadMap(bad)).toThrow(/tamanho zero/);
  });

  it('rejeita caminho que passa duas vezes pela mesma casa', () => {
    const bad = {
      ...small,
      path: [
        { x: 0, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 2 },
        { x: 1, y: 2 },
        { x: 1, y: 0 },
      ],
    };
    expect(() => loadMap(bad)).toThrow(/duas vezes/);
  });

  it('rejeita caminho com menos de 2 pontos e tamanho inválido', () => {
    expect(() => loadMap({ ...small, path: [{ x: 0, y: 0 }] })).toThrow(/pelo menos 2/);
    expect(() => loadMap({ ...small, width: 0 })).toThrow(/tamanho/);
    expect(() => loadMap({ ...small, height: 2.5 })).toThrow(/tamanho/);
  });
});

describe('GridMap', () => {
  const map = loadMap(small);

  it('torre só em casa livre dentro da grade', () => {
    expect(map.canPlaceTower({ x: 0, y: 0 })).toBe(true);
    expect(map.canPlaceTower({ x: 4, y: 3 })).toBe(true);
    expect(map.canPlaceTower({ x: 2, y: 1 })).toBe(false); // caminho
    expect(map.canPlaceTower(map.entrance)).toBe(false);
    expect(map.canPlaceTower(map.nexus)).toBe(false);
  });

  it('casas fora da grade não são caminho nem aceitam torre', () => {
    for (const cell of [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 5, y: 0 },
      { x: 0, y: 4 },
      { x: 0.5, y: 0 },
    ]) {
      expect(map.isInside(cell)).toBe(false);
      expect(map.isPath(cell)).toBe(false);
      expect(map.canPlaceTower(cell)).toBe(false);
    }
  });

  it('casas válidas para torre = largura × altura − casas do caminho', () => {
    for (const data of [small, mapData]) {
      const m = loadMap(data);
      let buildable = 0;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          if (m.canPlaceTower({ x, y })) buildable++;
        }
      }
      expect(buildable).toBe(m.width * m.height - m.pathCells.length);
    }
  });
});
