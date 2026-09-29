/**
 * Rota contínua que os inimigos percorrem, medida em casas.
 *
 * É uma linha poligonal pelos centros das casas: a rota terrestre passa por
 * todas as casas do caminho; a aérea é um trecho reto da entrada ao núcleo.
 * A posição de um inimigo é só a distância percorrida desde o início.
 */

import type { GridCoord, GridMap } from '../grid/map';
import type { Movement } from './enemyData';

export interface MutablePoint {
  x: number;
  y: number;
}

export class Route {
  /** Comprimento total, em casas. */
  readonly length: number;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  /** Distância acumulada até cada ponto; `cumulative[0] = 0`. */
  private readonly cumulative: Float64Array;

  constructor(points: readonly GridCoord[]) {
    if (points.length < 2) {
      throw new Error('Rota inválida: precisa de pelo menos 2 pontos');
    }
    const n = points.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.cumulative = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      if (i > 0) {
        const segment = Math.hypot(p.x - this.xs[i - 1]!, p.y - this.ys[i - 1]!);
        if (segment === 0) {
          throw new Error(`Rota inválida: ponto repetido em (${p.x}, ${p.y})`);
        }
        this.cumulative[i] = this.cumulative[i - 1]! + segment;
      }
    }
    this.length = this.cumulative[n - 1]!;
  }

  /**
   * Escreve em `out` o ponto a `distance` casas do início, sem alocar.
   * Distâncias fora de [0, length] ficam presas nas pontas.
   */
  sampleInto(distance: number, out: MutablePoint): void {
    const last = this.cumulative.length - 1;
    if (distance <= 0) {
      out.x = this.xs[0]!;
      out.y = this.ys[0]!;
      return;
    }
    if (distance >= this.length) {
      out.x = this.xs[last]!;
      out.y = this.ys[last]!;
      return;
    }
    // Busca binária pelo trecho [lo, lo + 1] que contém `distance`.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid]! <= distance) lo = mid;
      else hi = mid;
    }
    const start = this.cumulative[lo]!;
    const t = (distance - start) / (this.cumulative[hi]! - start);
    out.x = this.xs[lo]! + (this.xs[hi]! - this.xs[lo]!) * t;
    out.y = this.ys[lo]! + (this.ys[hi]! - this.ys[lo]!) * t;
  }
}

export type Routes = Readonly<Record<Movement, Route>>;

export function buildRoutes(map: GridMap): Routes {
  return {
    ground: new Route(map.pathCells),
    air: new Route([map.entrance, map.nexus]),
  };
}
