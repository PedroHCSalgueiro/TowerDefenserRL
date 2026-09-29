/**
 * Projeção isométrica entre a grade e a tela.
 *
 * Matemática pura, sem Phaser, para ser testada no Vitest. A casa (0,0) fica no
 * topo do losango do mapa; `x` cresce para baixo à direita e `y` para baixo à
 * esquerda. `origin` é o centro da casa (0,0) na tela.
 */

import type { GridCoord } from '../sim/grid/map';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Vértices do losango: topo, direita, baixo, esquerda. */
export type Diamond = readonly [Point, Point, Point, Point];

/**
 * Profundidade de desenho isométrica: quem tem `x + y` maior fica mais abaixo
 * na tela e é desenhado por cima. Vale para torres e inimigos (mesma Layer).
 */
export function isoDepth(cell: GridCoord): number {
  return cell.x + cell.y;
}

export class IsoProjection {
  readonly tile: Size;
  readonly origin: Point;

  constructor(tile: Size, origin: Point) {
    this.tile = tile;
    this.origin = origin;
  }

  /** Projeção com o losango do mapa centralizado na área de tela `viewport`. */
  static centered(grid: Size, tile: Size, viewport: Size): IsoProjection {
    const halfW = tile.width / 2;
    const halfH = tile.height / 2;
    return new IsoProjection(tile, {
      x: viewport.width / 2 - ((grid.width - grid.height) * halfW) / 2,
      y: viewport.height / 2 - ((grid.width + grid.height - 2) * halfH) / 2,
    });
  }

  /** Centro da casa na tela. Aceita coordenadas fracionárias. */
  toScreen(cell: GridCoord): Point {
    return {
      x: this.origin.x + ((cell.x - cell.y) * this.tile.width) / 2,
      y: this.origin.y + ((cell.x + cell.y) * this.tile.height) / 2,
    };
  }

  /**
   * Casa sob o ponto da tela, ou `null` fora do mapa. Um ponto exatamente sobre
   * uma aresta fica com a casa de índice maior.
   */
  toGrid(point: Point, map: { isInside(cell: GridCoord): boolean }): GridCoord | null {
    const u = (point.x - this.origin.x) / (this.tile.width / 2);
    const v = (point.y - this.origin.y) / (this.tile.height / 2);
    const cell = { x: Math.floor((u + v) / 2 + 0.5), y: Math.floor((v - u) / 2 + 0.5) };
    return map.isInside(cell) ? cell : null;
  }

  /**
   * Largura e altura, na tela, de um círculo de raio `radius` casas na grade.
   * A projeção transforma o círculo numa elipse alinhada aos eixos, com
   * semieixos `radius · tile / √2`.
   */
  circleSize(radius: number): Size {
    return {
      width: radius * this.tile.width * Math.SQRT2,
      height: radius * this.tile.height * Math.SQRT2,
    };
  }

  diamond(cell: GridCoord): Diamond {
    const c = this.toScreen(cell);
    const halfW = this.tile.width / 2;
    const halfH = this.tile.height / 2;
    return [
      { x: c.x, y: c.y - halfH },
      { x: c.x + halfW, y: c.y },
      { x: c.x, y: c.y + halfH },
      { x: c.x - halfW, y: c.y },
    ];
  }
}
