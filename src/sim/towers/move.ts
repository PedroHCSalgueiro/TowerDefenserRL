/**
 * Mover e trocar torres já posicionadas (T15). Fora da onda é grátis: a
 * torre vai para a casa livre pedida, ou troca de lugar com a torre que
 * estiver nela. Com qualquer onda na lista ativa (`waves.active`), inclusive
 * empilhada ou já limpa esperando a anterior fechar, as torres ficam travadas.
 *
 * A torre é o mesmo objeto: leva junto id, estrela, `invested`, recarga,
 * contadores, cargas, trava de ativação e último efeito. A ordem em
 * `state.towers` (ordem de disparo) não muda. Os bônus de classe e a
 * vizinhança dos gatilhos são recalculados a cada tick.
 */

import type { TickContext } from '../engine/simulation';
import type { GridCoord, GridMap } from '../grid/map';
import type { RunState } from '../state';

/** As torres posicionadas estão travadas: há onda na lista ativa. */
export function towersLocked(state: Readonly<RunState>): boolean {
  return state.waves.active.length > 0;
}

/**
 * Move a torre para a casa (troca, se houver outra torre nela). Torre
 * inexistente ou a própria casa: nada acontece, sem evento. Torres travadas
 * ou casa inválida (fora do mapa, caminho, núcleo): emite `moveRefused`.
 */
export function moveTower(
  ctx: TickContext,
  map: Pick<GridMap, 'canPlaceTower'>,
  towerId: number,
  cell: GridCoord,
): boolean {
  const { state } = ctx;
  const tower = state.towers.find((t) => t.id === towerId);
  if (!tower || (tower.x === cell.x && tower.y === cell.y)) return false;
  const refuse = (reason: 'locked' | 'invalid'): false => {
    ctx.emit({ type: 'moveRefused', tick: state.tick, towerId, reason });
    return false;
  };
  if (towersLocked(state)) return refuse('locked');
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !map.canPlaceTower(cell)) {
    return refuse('invalid');
  }

  const other = state.towers.find((t) => t.x === cell.x && t.y === cell.y) ?? null;
  const from = { x: tower.x, y: tower.y };
  if (other) {
    other.x = from.x;
    other.y = from.y;
  }
  tower.x = cell.x;
  tower.y = cell.y;
  ctx.emit({
    type: 'towerMoved',
    tick: state.tick,
    towerId,
    fromX: from.x,
    fromY: from.y,
    x: cell.x,
    y: cell.y,
    swappedWithId: other?.id ?? null,
  });
  return true;
}
