import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import renderConfig from '../src/data/render.json';
import { IsoProjection, isoDepth, type Point } from '../src/render/iso';
import { loadMap, type GridCoord } from '../src/sim/grid/map';

const map = loadMap(mapData);
const tile = renderConfig.tile;
const halfW = tile.width / 2;
const halfH = tile.height / 2;
const iso = new IsoProjection(tile, { x: 640, y: 100 });

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Distância "de losango" do ponto ao centro da casa: < 1 dentro, > 1 fora. */
function diamondDistance(point: Point, cell: GridCoord): number {
  const c = iso.toScreen(cell);
  return Math.abs(point.x - c.x) / halfW + Math.abs(point.y - c.y) / halfH;
}

function allCells(): GridCoord[] {
  const cells: GridCoord[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) cells.push({ x, y });
  }
  return cells;
}

describe('IsoProjection', () => {
  it('(0,0) fica na origem; +x anda (+w/2, +h/2) e +y anda (−w/2, +h/2)', () => {
    expect(iso.toScreen({ x: 0, y: 0 })).toEqual(iso.origin);
    expect(iso.toScreen({ x: 1, y: 0 })).toEqual({ x: 640 + halfW, y: 100 + halfH });
    expect(iso.toScreen({ x: 0, y: 1 })).toEqual({ x: 640 - halfW, y: 100 + halfH });
  });

  it('o centro de cada casa do mapa volta para a mesma casa', () => {
    for (const cell of allCells()) {
      expect(iso.toGrid(iso.toScreen(cell), map)).toEqual(cell);
    }
  });

  it('logo dentro de cada vértice do losango continua na mesma casa', () => {
    for (const cell of allCells()) {
      const center = iso.toScreen(cell);
      for (const vertex of iso.diamond(cell)) {
        expect(iso.toGrid(lerp(center, vertex, 0.99), map)).toEqual(cell);
      }
    }
  });

  it('atravessar cada lado leva à vizinha correspondente', () => {
    const cell = { x: 5, y: 5 };
    const center = iso.toScreen(cell);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const nextCenter = iso.toScreen(next);
      expect(iso.toGrid(lerp(center, nextCenter, 0.49), map)).toEqual(cell);
      expect(iso.toGrid(lerp(center, nextCenter, 0.51), map)).toEqual(next);
    }
  });

  it('fora de cada borda do mapa devolve null', () => {
    const last = { x: map.width - 1, y: map.height - 1 };
    for (const cell of allCells()) {
      const center = iso.toScreen(cell);
      const outward: GridCoord[] = [];
      if (cell.x === 0) outward.push({ x: -1, y: cell.y });
      if (cell.y === 0) outward.push({ x: cell.x, y: -1 });
      if (cell.x === last.x) outward.push({ x: map.width, y: cell.y });
      if (cell.y === last.y) outward.push({ x: cell.x, y: map.height });
      for (const out of outward) {
        const outCenter = iso.toScreen(out);
        expect(iso.toGrid(lerp(center, outCenter, 0.49), map)).toEqual(cell);
        expect(iso.toGrid(lerp(center, outCenter, 0.51), map)).toBeNull();
      }
    }
  });

  it('além dos 4 cantos extremos do mapa devolve null', () => {
    const top = iso.diamond({ x: 0, y: 0 })[0];
    const right = iso.diamond({ x: map.width - 1, y: 0 })[1];
    const bottom = iso.diamond({ x: map.width - 1, y: map.height - 1 })[2];
    const left = iso.diamond({ x: 0, y: map.height - 1 })[3];
    expect(iso.toGrid({ x: top.x, y: top.y - 0.5 }, map)).toBeNull();
    expect(iso.toGrid({ x: right.x + 0.5, y: right.y }, map)).toBeNull();
    expect(iso.toGrid({ x: bottom.x, y: bottom.y + 0.5 }, map)).toBeNull();
    expect(iso.toGrid({ x: left.x - 0.5, y: left.y }, map)).toBeNull();
    expect(iso.toGrid({ x: top.x, y: top.y + 0.5 }, map)).toEqual({ x: 0, y: 0 });
  });

  it('ponto exatamente sobre uma aresta fica com a casa de índice maior', () => {
    const c = iso.toScreen({ x: 3, y: 3 });
    expect(iso.toGrid({ x: c.x + halfW / 2, y: c.y + halfH / 2 }, map)).toEqual({ x: 4, y: 3 });
    expect(iso.toGrid({ x: c.x - halfW / 2, y: c.y + halfH / 2 }, map)).toEqual({ x: 3, y: 4 });
    expect(iso.toGrid({ x: c.x - halfW / 2, y: c.y - halfH / 2 }, map)).toEqual({ x: 3, y: 3 });
  });

  it('varredura: todo ponto cai no losango da casa devolvida, e null só fora de todos', () => {
    const left = iso.toScreen({ x: 0, y: map.height - 1 }).x - halfW - 10;
    const right = iso.toScreen({ x: map.width - 1, y: 0 }).x + halfW + 10;
    const top = iso.origin.y - halfH - 10;
    const bottom = iso.toScreen({ x: map.width - 1, y: map.height - 1 }).y + halfH + 10;
    const cells = allCells();
    const eps = 1e-9;
    let hits = 0;
    let misses = 0;
    const failures: string[] = [];
    // Passo não múltiplo do losango, para não cair só sobre arestas.
    for (let y = top; y <= bottom; y += 2.93) {
      for (let x = left; x <= right; x += 2.93) {
        const point = { x, y };
        const cell = iso.toGrid(point, map);
        if (cell) {
          hits++;
          if (diamondDistance(point, cell) > 1 + eps) {
            failures.push(`(${x}, ${y}) -> (${cell.x}, ${cell.y}) fora do losango`);
          }
        } else {
          misses++;
          const inside = cells.find((c) => diamondDistance(point, c) < 1 - eps);
          if (inside) failures.push(`(${x}, ${y}) -> null, mas está em (${inside.x}, ${inside.y})`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(hits).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });

  it('centered põe o losango do mapa no centro da tela', () => {
    const viewport = { width: 1280, height: 720 };
    const centered = IsoProjection.centered(map, tile, viewport);
    const top = centered.diamond({ x: 0, y: 0 })[0];
    const right = centered.diamond({ x: map.width - 1, y: 0 })[1];
    const bottom = centered.diamond({ x: map.width - 1, y: map.height - 1 })[2];
    const left = centered.diamond({ x: 0, y: map.height - 1 })[3];
    expect((left.x + right.x) / 2).toBeCloseTo(viewport.width / 2);
    expect((top.y + bottom.y) / 2).toBeCloseTo(viewport.height / 2);

    const wide = IsoProjection.centered({ width: 10, height: 4 }, tile, viewport);
    const wideLeft = wide.diamond({ x: 0, y: 3 })[3];
    const wideRight = wide.diamond({ x: 9, y: 0 })[1];
    expect((wideLeft.x + wideRight.x) / 2).toBeCloseTo(viewport.width / 2);
  });

  it('circleSize: um círculo de raio r casas vira a elipse que passa pelos pontos projetados', () => {
    for (const radius of [0.5, 1, 2.5, 3]) {
      const { width, height } = iso.circleSize(radius);
      const center = iso.toScreen({ x: 4, y: 7 });
      for (let k = 0; k < 64; k++) {
        const angle = (k / 64) * 2 * Math.PI;
        const p = iso.toScreen({
          x: 4 + radius * Math.cos(angle),
          y: 7 + radius * Math.sin(angle),
        });
        const e = ((p.x - center.x) / (width / 2)) ** 2 + ((p.y - center.y) / (height / 2)) ** 2;
        expect(e).toBeCloseTo(1, 9);
      }
    }
  });
});

describe('isoDepth', () => {
  it('é x + y: quem está mais abaixo na tela fica na frente', () => {
    expect(isoDepth({ x: 3, y: 4 })).toBe(7);
    expect(isoDepth({ x: 2.5, y: 0.25 })).toBe(2.75);
    // Mesma ordem que a altura na tela, para torres (inteiras) e inimigos (fracionários).
    const a = { x: 2, y: 3 };
    const b = { x: 4.1, y: 1 };
    expect(Math.sign(isoDepth(b) - isoDepth(a))).toBe(
      Math.sign(iso.toScreen(b).y - iso.toScreen(a).y),
    );
  });
});
