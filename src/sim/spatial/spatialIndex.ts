/**
 * Índice espacial dos inimigos: grade uniforme (hash espacial) reconstruída
 * uma vez por tick, para achar inimigos no alcance sem testar todos.
 *
 * A reconstrução é preguiçosa: a primeira consulta de cada tick monta o
 * índice com as posições daquele momento. Por isso toda consulta precisa
 * acontecer depois do movimento. Inimigos que morrem depois da montagem
 * continuam nas listas, mas são ignorados (`active === false`); nenhum
 * inimigo nasce depois do movimento, então não há slot reaproveitado no
 * meio do tick.
 *
 * O índice é derivado do estado e não entra no save: um estado restaurado
 * monta o mesmo índice. As células cobrem só a área ocupada pelos inimigos
 * (limites recalculados a cada montagem), sem depender do tamanho do mapa.
 */

import type { Enemy, EnemyPool } from '../enemies/pool';

interface IndexedState {
  readonly tick: number;
  readonly enemies: EnemyPool;
}

export class SpatialIndex {
  private readonly cellSize: number;
  private builtFor: IndexedState | null = null;
  private builtTick = -1;

  private minX = 0;
  private minY = 0;
  private cols = 0;
  private rows = 0;
  /** Início de cada célula em `items`; a célula `c` vai de `cellStart[c]` a `cellStart[c + 1]`. */
  private cellStart = new Int32Array(1);
  private cursor = new Int32Array(0);
  /** Slots dos inimigos, agrupados por célula. */
  private items = new Int32Array(0);
  /** Célula de cada slot na última montagem. */
  private slotCell = new Int32Array(0);

  constructor(cellSize: number) {
    if (!(cellSize > 0)) {
      throw new RangeError(`SpatialIndex: tamanho de célula inválido (${cellSize})`);
    }
    this.cellSize = cellSize;
  }

  /**
   * Inimigo ativo mais próximo de (x, y) com distância ≤ `range` (a borda
   * conta). Empate na distância: vence o menor id. `null` se não houver.
   */
  findNearest(state: IndexedState, x: number, y: number, range: number): Enemy | null {
    this.ensure(state);
    if (this.cols === 0) return null;

    const slots = state.enemies.slots;
    const rangeSq = range * range;
    const x0 = this.col(x - range);
    const x1 = this.col(x + range);
    const y0 = this.row(y - range);
    const y1 = this.row(y + range);

    let best: Enemy | null = null;
    let bestSq = Infinity;
    for (let cy = y0; cy <= y1; cy++) {
      const rowBase = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const cell = rowBase + cx;
        const end = this.cellStart[cell + 1]!;
        for (let i = this.cellStart[cell]!; i < end; i++) {
          const enemy = slots[this.items[i]!]!;
          if (!enemy.active) continue;
          const dx = enemy.x - x;
          const dy = enemy.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq > rangeSq) continue;
          if (distSq < bestSq || (distSq === bestSq && best !== null && enemy.id < best.id)) {
            best = enemy;
            bestSq = distSq;
          }
        }
      }
    }
    return best;
  }

  /** Força a montagem do índice com as posições atuais do pool. */
  rebuild(pool: EnemyPool): void {
    const slots = pool.slots;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const enemy of slots) {
      if (!enemy.active) continue;
      if (enemy.x < minX) minX = enemy.x;
      if (enemy.x > maxX) maxX = enemy.x;
      if (enemy.y < minY) minY = enemy.y;
      if (enemy.y > maxY) maxY = enemy.y;
    }
    if (minX === Infinity) {
      this.cols = 0;
      this.rows = 0;
      return;
    }

    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / this.cellSize) + 1;
    this.rows = Math.floor((maxY - minY) / this.cellSize) + 1;
    const cells = this.cols * this.rows;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array((cells + 1) * 2);
      this.cursor = new Int32Array((cells + 1) * 2);
    }
    if (this.slotCell.length < slots.length) {
      this.slotCell = new Int32Array(slots.length * 2);
      this.items = new Int32Array(slots.length * 2);
    }

    // Contagem por célula, soma acumulada e preenchimento (counting sort).
    const cellStart = this.cellStart;
    cellStart.fill(0, 0, cells + 1);
    for (const enemy of slots) {
      if (!enemy.active) continue;
      const cell = this.row(enemy.y) * this.cols + this.col(enemy.x);
      this.slotCell[enemy.slot] = cell;
      cellStart[cell + 1] = cellStart[cell + 1]! + 1;
    }
    for (let c = 0; c < cells; c++) {
      cellStart[c + 1] = cellStart[c + 1]! + cellStart[c]!;
    }
    const cursor = this.cursor;
    cursor.set(cellStart.subarray(0, cells));
    for (const enemy of slots) {
      if (!enemy.active) continue;
      const cell = this.slotCell[enemy.slot]!;
      this.items[cursor[cell]!] = enemy.slot;
      cursor[cell] = cursor[cell]! + 1;
    }
  }

  private ensure(state: IndexedState): void {
    if (this.builtFor === state && this.builtTick === state.tick) return;
    this.rebuild(state.enemies);
    this.builtFor = state;
    this.builtTick = state.tick;
  }

  /** Coluna da coordenada, presa à área indexada. */
  private col(x: number): number {
    return clampInt(Math.floor((x - this.minX) / this.cellSize), this.cols - 1);
  }

  private row(y: number): number {
    return clampInt(Math.floor((y - this.minY) / this.cellSize), this.rows - 1);
  }
}

function clampInt(value: number, max: number): number {
  return value < 0 ? 0 : value > max ? max : value;
}
