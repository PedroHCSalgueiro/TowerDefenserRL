/**
 * Índice espacial dos inimigos: grade uniforme (hash espacial) reconstruída
 * uma vez por tick, para achar inimigos no alcance sem testar todos.
 *
 * A reconstrução é preguiçosa: a primeira consulta de cada tick monta o
 * índice com as posições daquele momento. Por isso toda consulta precisa
 * acontecer depois do movimento. Inimigos que morrem depois da montagem são
 * ignorados (`active === false`) e saem da célula na próxima consulta que
 * passar por ela (compactação que mantém a ordem): numa avalanche, as
 * consultas seguintes não varrem de novo os mortos. Nenhum inimigo nasce
 * depois do movimento, então não há slot reaproveitado no meio do tick.
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
  /** Início de cada célula em `items`; a célula `c` começa em `cellStart[c]`. */
  private cellStart = new Int32Array(1);
  /** Fim (exclusivo) dos itens ainda não compactados da célula `c`. */
  private cellEnd = new Int32Array(0);
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
   * `skip` descarta candidatos (ex.: inimigos que o raio em cadeia já atingiu).
   */
  findNearest(
    state: IndexedState,
    x: number,
    y: number,
    range: number,
    skip?: (enemy: Enemy) => boolean,
  ): Enemy | null {
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
        const end = this.compact(cell, slots);
        for (let i = this.cellStart[cell]!; i < end; i++) {
          const enemy = slots[this.items[i]!]!;
          const dx = enemy.x - x;
          const dy = enemy.y - y;
          const distSq = dx * dx + dy * dy;
          if (distSq > rangeSq) continue;
          if (skip?.(enemy)) continue;
          if (distSq < bestSq || (distSq === bestSq && best !== null && enemy.id < best.id)) {
            best = enemy;
            bestSq = distSq;
          }
        }
      }
    }
    return best;
  }

  /**
   * Inimigo ativo com distância ≤ `range` de (x, y) que tem a menor nota
   * (`score`). Empate na nota: vence o menor id. `null` se não houver.
   */
  findBest(
    state: IndexedState,
    x: number,
    y: number,
    range: number,
    score: (enemy: Enemy, x: number, y: number) => number,
  ): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    this.forEachInRange(state, x, y, range, (enemy) => {
      const s = score(enemy, x, y);
      if (best === null || s < bestScore || (s === bestScore && enemy.id < best.id)) {
        best = enemy;
        bestScore = s;
      }
    });
    return best;
  }

  /**
   * Acrescenta em `out` os inimigos ativos com distância ≤ `range` de (x, y),
   * em ordem de célula (quem precisa de uma ordem fixa ordena depois).
   */
  collectInRange(state: IndexedState, x: number, y: number, range: number, out: Enemy[]): Enemy[] {
    this.forEachInRange(state, x, y, range, (enemy) => {
      out.push(enemy);
    });
    return out;
  }

  private forEachInRange(
    state: IndexedState,
    x: number,
    y: number,
    range: number,
    visit: (enemy: Enemy) => void,
  ): void {
    this.ensure(state);
    if (this.cols === 0) return;

    const slots = state.enemies.slots;
    const rangeSq = range * range;
    const x0 = this.col(x - range);
    const x1 = this.col(x + range);
    const y0 = this.row(y - range);
    const y1 = this.row(y + range);
    for (let cy = y0; cy <= y1; cy++) {
      const rowBase = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const cell = rowBase + cx;
        const end = this.compact(cell, slots);
        for (let i = this.cellStart[cell]!; i < end; i++) {
          const enemy = slots[this.items[i]!]!;
          const dx = enemy.x - x;
          const dy = enemy.y - y;
          if (dx * dx + dy * dy <= rangeSq) visit(enemy);
        }
      }
    }
  }

  /**
   * Tira da célula os inimigos que morreram desde a montagem, mantendo a
   * ordem dos vivos, e devolve o novo fim. Quem chama só vê inimigos ativos.
   */
  private compact(cell: number, slots: readonly Enemy[]): number {
    const items = this.items;
    const end = this.cellEnd[cell]!;
    let write = this.cellStart[cell]!;
    for (let read = write; read < end; read++) {
      const slot = items[read]!;
      if (!slots[slot]!.active) continue;
      if (write !== read) items[write] = slot;
      write++;
    }
    this.cellEnd[cell] = write;
    return write;
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
      this.cellEnd = new Int32Array((cells + 1) * 2);
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
    this.cellEnd.set(cellStart.subarray(1, cells + 1));
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
