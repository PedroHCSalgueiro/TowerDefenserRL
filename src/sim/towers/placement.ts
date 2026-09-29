/**
 * Torres no mapa e a regra de posicionamento. É chamado pela ação
 * `placeTower` e pelo spawn em massa do debug, sempre dentro de um tick.
 */

import type { TickContext } from '../engine/simulation';
import type { GridCoord, GridMap } from '../grid/map';
import { hasTowerType, type TowerData } from './towerData';

export interface Tower {
  id: number;
  type: string;
  /** Casa da torre (inteiros). */
  x: number;
  y: number;
  /** Ticks até o próximo disparo; 0 = pronta. */
  cooldownTicks: number;
}

/**
 * Posiciona uma torre do tipo pedido. A casa precisa estar dentro do mapa,
 * fora do caminho e sem torre, e o tipo precisa existir. Se não der, nada
 * muda (nem um id é gasto) e devolve `null`; se der, emite `towerPlaced`.
 */
export function placeTower(
  ctx: TickContext,
  map: GridMap,
  data: TowerData,
  towerType: string,
  cell: GridCoord,
): Tower | null {
  const { state } = ctx;
  if (!hasTowerType(data, towerType) || !map.canPlaceTower(cell)) return null;
  if (state.towers.some((t) => t.x === cell.x && t.y === cell.y)) return null;

  const tower: Tower = {
    id: ctx.allocateId(),
    type: towerType,
    x: cell.x,
    y: cell.y,
    cooldownTicks: 0,
  };
  state.towers.push(tower);
  ctx.emit({
    type: 'towerPlaced',
    tick: state.tick,
    towerId: tower.id,
    towerType,
    x: tower.x,
    y: tower.y,
  });
  return tower;
}
