/**
 * Escolha de casas para o spawn de torres em massa do debug (modo estresse e
 * painel). As torres em si são as reais (`src/sim/towers/`).
 */

import type { GridCoord, GridMap } from '../grid/map';
import type { DebugLayout } from '../state';

/**
 * Tipo da torre de uma casa quando o debug mistura vários tipos: o índice é
 * `(x + 2y) mod n`. Com 4 tipos, as 4 vizinhas de lado de uma casa caem nos
 * outros 3 tipos (x±1 → ±1, y±1 → ±2), então num bloco compacto cada torre
 * encosta em todos os outros tipos. `null` se a lista estiver vazia.
 */
export function patternTowerType(types: readonly string[], cell: GridCoord): string | null {
  if (types.length === 0) return null;
  const n = types.length;
  return types[(((cell.x + 2 * cell.y) % n) + n) % n]!;
}

function byRowThenColumn(a: GridCoord, b: GridCoord): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * Escolhe até `count` casas livres (fora do caminho e sem torre), em ordem
 * determinística:
 * - `clustered`: as mais próximas da entrada.
 * - `spread`: as casas vizinhas do caminho (8 direções), distribuídas por
 *   igual do começo ao fim do caminho; se faltar, completa pelas mais
 *   próximas da entrada.
 */
export function pickTowerCells(
  map: GridMap,
  occupied: ReadonlySet<number>,
  count: number,
  layout: DebugLayout,
): GridCoord[] {
  const free: GridCoord[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = { x, y };
      if (map.canPlaceTower(cell) && !occupied.has(map.indexOf(cell))) free.push(cell);
    }
  }
  const { entrance } = map;
  const entranceDistSq = (c: GridCoord): number =>
    (c.x - entrance.x) ** 2 + (c.y - entrance.y) ** 2;
  const byEntrance = [...free].sort(
    (a, b) => entranceDistSq(a) - entranceDistSq(b) || byRowThenColumn(a, b),
  );
  if (layout === 'clustered' || count <= 0) return byEntrance.slice(0, Math.max(0, count));

  // Índice, no caminho, da primeira casa de caminho vizinha de cada casa.
  const pathIndex = new Map<number, number>();
  map.pathCells.forEach((cell, i) => pathIndex.set(map.indexOf(cell), i));
  const alongPath: { cell: GridCoord; order: number }[] = [];
  for (const cell of free) {
    let order = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: cell.x + dx, y: cell.y + dy };
        if (!map.isPath(n)) continue;
        order = Math.min(order, pathIndex.get(map.indexOf(n))!);
      }
    }
    if (order !== Infinity) alongPath.push({ cell, order });
  }
  alongPath.sort((a, b) => a.order - b.order || byRowThenColumn(a.cell, b.cell));

  const picked: GridCoord[] = [];
  if (count >= alongPath.length) {
    picked.push(...alongPath.map((c) => c.cell));
  } else {
    // Passo uniforme que inclui a primeira e a última casa ao longo do caminho.
    for (let i = 0; i < count; i++) {
      const at = count === 1 ? 0 : Math.round((i * (alongPath.length - 1)) / (count - 1));
      picked.push(alongPath[at]!.cell);
    }
  }
  const taken = new Set(picked.map((c) => map.indexOf(c)));
  for (const cell of byEntrance) {
    if (picked.length >= count) break;
    if (!taken.has(map.indexOf(cell))) picked.push(cell);
  }
  return picked;
}
