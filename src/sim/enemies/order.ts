/**
 * Ordenação de listas de inimigos por id (a ordem determinística de dano em
 * área e dos efeitos de gatilho).
 *
 * Numa avalanche, uma explosão pode atingir centenas de inimigos, várias
 * vezes por tick. Em vez de `sort` com comparador, a lista é conferida (já
 * em ordem? nada a fazer) e, se preciso, ordenada por uma chave numérica
 * `id × 2^20 + posição` num `Float64Array` (ordenação nativa). Como os ids são
 * únicos, o resultado é exatamente o mesmo da ordenação por id.
 */

import type { Enemy } from './pool';

/** Posições por lista (2^20); com ids até 2^33, a chave cabe exata no Float64. */
const INDEX_BITS = 2 ** 20;
const MAX_KEYED_ID = 2 ** 33;

const byId = (a: Enemy, b: Enemy): number => a.id - b.id;

let keys = new Float64Array(256);
const scratch: Enemy[] = [];

/** Ordena `list` por id, no próprio array, e o devolve. */
export function sortEnemiesById(list: Enemy[]): Enemy[] {
  const n = list.length;
  let sorted = true;
  for (let i = 1; i < n; i++) {
    if (list[i - 1]!.id > list[i]!.id) {
      sorted = false;
      break;
    }
  }
  if (sorted) return list;
  if (n > INDEX_BITS) return list.sort(byId);

  if (keys.length < n) keys = new Float64Array(n * 2);
  const view = keys.subarray(0, n);
  for (let i = 0; i < n; i++) {
    const id = list[i]!.id;
    // Id grande demais para a chave exata: volta ao comparador (mesmo resultado).
    if (id >= MAX_KEYED_ID) return list.sort(byId);
    view[i] = id * INDEX_BITS + i;
  }
  view.sort();
  scratch.length = 0;
  for (let i = 0; i < n; i++) scratch.push(list[view[i]! % INDEX_BITS]!);
  for (let i = 0; i < n; i++) list[i] = scratch[i]!;
  scratch.length = 0;
  return list;
}
