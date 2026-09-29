/**
 * Mapa em grade: casas, caminho fixo, entrada e núcleo.
 *
 * O mapa vem de dados (`src/data/map.json`). O caminho é descrito por pontos de
 * virada: o primeiro é a entrada e o último é o núcleo. Cada trecho entre dois
 * pontos é reto (horizontal ou vertical) e vira uma sequência de casas.
 */

export interface GridCoord {
  readonly x: number;
  readonly y: number;
}

export interface MapData {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Pontos de virada, da entrada até o núcleo. */
  readonly path: readonly GridCoord[];
}

export class GridMap {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Todas as casas do caminho, em ordem, da entrada até o núcleo. */
  readonly pathCells: readonly GridCoord[];
  readonly entrance: GridCoord;
  /** O núcleo ocupa 1 casa: a última do caminho. */
  readonly nexus: GridCoord;
  private readonly pathMask: Uint8Array;

  constructor(id: string, width: number, height: number, pathCells: readonly GridCoord[]) {
    this.id = id;
    this.width = width;
    this.height = height;
    this.pathCells = pathCells;
    this.entrance = pathCells[0]!;
    this.nexus = pathCells[pathCells.length - 1]!;
    this.pathMask = new Uint8Array(width * height);
    for (const cell of pathCells) {
      this.pathMask[this.indexOf(cell)] = 1;
    }
  }

  isInside(cell: GridCoord): boolean {
    return inBounds(cell, this.width, this.height);
  }

  /** Índice linear da casa (`y * width + x`). Só vale para casas dentro da grade. */
  indexOf(cell: GridCoord): number {
    return cell.y * this.width + cell.x;
  }

  /** Entrada e núcleo contam como caminho. */
  isPath(cell: GridCoord): boolean {
    return this.isInside(cell) && this.pathMask[this.indexOf(cell)] === 1;
  }

  /** Torres só vão em casas dentro da grade e fora do caminho. */
  canPlaceTower(cell: GridCoord): boolean {
    return this.isInside(cell) && this.pathMask[this.indexOf(cell)] === 0;
  }
}

/** Valida os dados do mapa e expande os pontos de virada em casas. */
export function loadMap(data: MapData): GridMap {
  const { width, height } = data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Mapa inválido: tamanho ${width}x${height}`);
  }
  return new GridMap(data.id, width, height, expandPath(data.path, width, height));
}

function inBounds(cell: GridCoord, width: number, height: number): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < width &&
    cell.y < height
  );
}

function expandPath(waypoints: readonly GridCoord[], width: number, height: number): GridCoord[] {
  if (waypoints.length < 2) {
    throw new Error('Mapa inválido: o caminho precisa de pelo menos 2 pontos');
  }
  for (const p of waypoints) {
    if (!inBounds(p, width, height)) {
      throw new Error(`Mapa inválido: ponto (${p.x}, ${p.y}) fora da grade`);
    }
  }

  const first = waypoints[0]!;
  const cells: GridCoord[] = [{ x: first.x, y: first.y }];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1]!;
    const to = waypoints[i]!;
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    if (dx !== 0 && dy !== 0) {
      throw new Error(
        `Mapa inválido: trecho diagonal de (${from.x}, ${from.y}) a (${to.x}, ${to.y})`,
      );
    }
    if (dx === 0 && dy === 0) {
      throw new Error(`Mapa inválido: trecho de tamanho zero em (${to.x}, ${to.y})`);
    }
    let { x, y } = from;
    while (x !== to.x || y !== to.y) {
      x += dx;
      y += dy;
      cells.push({ x, y });
    }
  }

  const seen = new Set<number>();
  for (const cell of cells) {
    const index = cell.y * width + cell.x;
    if (seen.has(index)) {
      throw new Error(`Mapa inválido: o caminho passa duas vezes por (${cell.x}, ${cell.y})`);
    }
    seen.add(index);
  }
  return cells;
}
