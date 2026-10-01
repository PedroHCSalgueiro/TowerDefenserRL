/**
 * Arrastar torres do mapa (T15), sem DOM nem Phaser: só decide o que cada
 * gesto vira. O clique continua selecionando; só um arrasto acima do limiar
 * move. Soltar numa casa válida vira o comando `moveTower` (a simulação faz a
 * troca, se a casa tiver outra torre); numa casa inválida ou na própria casa,
 * o arrasto é cancelado sem comando.
 *
 * Com onda ativa, passar do limiar não começa o arrasto: devolve `locked`
 * para a interface mostrar a trava. Pausado, ou com a run encerrada, nada
 * começa e o arrasto em curso é cancelado em silêncio. Chamar uma onda no
 * meio do arrasto também cancela.
 */

import type { GridCoord, GridMap } from '../sim/grid/map';
import type { MoveTowerCommand, RunState } from '../sim/state';
import { towersLocked } from '../sim/towers/move';

interface Press {
  towerId: number;
  towerType: string;
  startX: number;
  startY: number;
  /** Passou do limiar com as torres livres: é um arrasto. */
  dragging: boolean;
}

/** Resultado de um movimento do mouse com o botão apertado sobre uma torre. */
export type DragMoveResult = 'none' | 'started' | 'locked';

/** A casa serve para soltar: livre ou com outra torre (troca). Mesma regra da simulação. */
export function canDropAt(map: Pick<GridMap, 'canPlaceTower'>, cell: GridCoord | null): boolean {
  return cell !== null && map.canPlaceTower(cell);
}

export class TowerDrag {
  private press: Press | null = null;

  /** Torre sendo arrastada (`null` = nenhuma, inclusive durante um clique ainda curto). */
  get dragging(): { towerId: number; towerType: string } | null {
    const p = this.press;
    return p?.dragging ? { towerId: p.towerId, towerType: p.towerType } : null;
  }

  /** Botão apertado sobre uma torre. Pausado ou com a run encerrada, não faz nada. */
  begin(
    state: Readonly<RunState>,
    paused: boolean,
    tower: { id: number; type: string },
    x: number,
    y: number,
  ): boolean {
    this.press = null;
    if (paused || state.status !== 'playing') return false;
    this.press = {
      towerId: tower.id,
      towerType: tower.type,
      startX: x,
      startY: y,
      dragging: false,
    };
    return true;
  }

  /** Mouse andou com o botão apertado. */
  pointerMove(
    state: Readonly<RunState>,
    x: number,
    y: number,
    thresholdPx: number,
  ): DragMoveResult {
    const p = this.press;
    if (!p || p.dragging) return 'none';
    if (Math.hypot(x - p.startX, y - p.startY) <= thresholdPx) return 'none';
    if (towersLocked(state)) {
      this.press = null;
      return 'locked';
    }
    p.dragging = true;
    return 'started';
  }

  /**
   * Botão solto sobre a casa `cell` (`null` = fora do mapa). Devolve o
   * comando de mover, ou `null` (clique curto, casa inválida, própria casa).
   */
  release(
    state: Readonly<RunState>,
    map: Pick<GridMap, 'canPlaceTower'>,
    cell: GridCoord | null,
  ): MoveTowerCommand | null {
    const p = this.press;
    this.press = null;
    if (!p?.dragging || cell === null || !canDropAt(map, cell)) return null;
    const tower = state.towers.find((t) => t.id === p.towerId);
    if (!tower || (tower.x === cell.x && tower.y === cell.y)) return null;
    return { type: 'moveTower', towerId: p.towerId, x: cell.x, y: cell.y };
  }

  /**
   * Chame a cada quadro: cancela em silêncio se pausou, se uma onda foi
   * chamada, se a run acabou ou se a torre saiu do mapa. Devolve `true` se cancelou.
   */
  update(state: Readonly<RunState>, paused: boolean): boolean {
    const p = this.press;
    if (!p) return false;
    const gone = !state.towers.some((t) => t.id === p.towerId);
    if (paused || state.status !== 'playing' || gone || (p.dragging && towersLocked(state))) {
      this.press = null;
      return true;
    }
    return false;
  }

  cancel(): void {
    this.press = null;
  }
}
