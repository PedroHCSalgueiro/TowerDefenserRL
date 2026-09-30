/**
 * Torres no mapa e a regra de posicionamento. É chamado pela ação
 * `placeTower` e pelo spawn em massa do debug, sempre dentro de um tick.
 */

import type { TickContext } from '../engine/simulation';
import type { GridCoord, GridMap } from '../grid/map';
import type { CopyableEffect } from '../triggers/triggerData';
import { clampStar } from './stars';
import { getTowerType, hasTowerType, type TowerData } from './towerData';

/** O último "o quê" que a torre disparou, para uma vizinha copiar. */
export interface LastEffect {
  /** O efeito com os números da torre que o disparou. */
  effect: CopyableEffect;
  /** Ordem global de disparo (`RunState.triggers.nextSeq`): maior = mais recente. */
  seq: number;
}

export interface Tower {
  id: number;
  type: string;
  /** Estrela (1 a 3 no protótipo). Vem do spawn do debug até a fusão (T11). */
  star: number;
  /** Casa da torre (inteiros). */
  x: number;
  y: number;
  /** Ticks até o próximo disparo; 0 = pronta. */
  cooldownTicks: number;
  /** Progresso do gatilho "a cada N" (tiros ou abates). */
  triggerCounter: number;
  /** Cargas do raio em cadeia. */
  charges: number;
  /** Primeiro tick em que a torre pode ser ativada de novo por gatilho. */
  activationReadyTick: number;
  /**
   * Ouro gasto na torre. A venda devolve parte dele e a fusão (T11) soma o
   * das cópias. Torres do debug e de teste têm 0.
   */
  invested: number;
  /** `null` = ainda não disparou nenhum "o quê" copiável. */
  lastEffect: LastEffect | null;
}

/** Torre nova, pronta para atirar e ser ativada. */
export function createTower(id: number, type: string, cell: GridCoord, star = 1): Tower {
  return {
    id,
    type,
    star,
    x: cell.x,
    y: cell.y,
    cooldownTicks: 0,
    triggerCounter: 0,
    charges: 0,
    activationReadyTick: 0,
    invested: 0,
    lastEffect: null,
  };
}

/**
 * Posiciona uma torre do tipo pedido. A casa precisa estar dentro do mapa,
 * fora do caminho e sem torre, e o tipo precisa existir. Se não der, nada
 * muda (nem um id é gasto) e devolve `null`; se der, emite `towerPlaced`.
 * `star` só é diferente de 1 no spawn do debug; é preso ao máximo do tipo.
 */
export function placeTower(
  ctx: TickContext,
  map: GridMap,
  data: TowerData,
  towerType: string,
  cell: GridCoord,
  star = 1,
): Tower | null {
  const { state } = ctx;
  if (!hasTowerType(data, towerType) || !map.canPlaceTower(cell)) return null;
  if (state.towers.some((t) => t.x === cell.x && t.y === cell.y)) return null;

  const tower = createTower(
    ctx.allocateId(),
    towerType,
    cell,
    clampStar(getTowerType(data, towerType), star),
  );
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
