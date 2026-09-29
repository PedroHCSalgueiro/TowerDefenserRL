/**
 * Vizinhança de casas na grade.
 *
 * Padrão: 4 vizinhas (lados). Com 8, entram as diagonais (bônus da Arcana).
 * A ordem é fixa, para manter a simulação determinística.
 */

import type { GridCoord, GridMap } from './map';

export type Neighborhood = 4 | 8;

/** Em coordenadas da grade: y−1, x+1, y+1, x−1. */
const ORTHOGONAL = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

const DIAGONAL = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const;

/** Vizinhas dentro da grade, na ordem fixa: lados primeiro, depois diagonais. */
export function neighbors(
  map: Pick<GridMap, 'isInside'>,
  cell: GridCoord,
  neighborhood: Neighborhood = 4,
): GridCoord[] {
  const offsets = neighborhood === 8 ? [...ORTHOGONAL, ...DIAGONAL] : ORTHOGONAL;
  const result: GridCoord[] = [];
  for (const [dx, dy] of offsets) {
    const next = { x: cell.x + dx, y: cell.y + dy };
    if (map.isInside(next)) result.push(next);
  }
  return result;
}
