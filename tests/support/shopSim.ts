/**
 * Apoio aos testes de economia e loja: partida no mapa real, com os dados
 * reais de torres, inimigos e economia.
 */

import mapData from '../../src/data/map.json';
import { Simulation } from '../../src/sim/engine/simulation';
import type { SimEvent } from '../../src/sim/engine/events';
import { loadMap, type GridCoord } from '../../src/sim/grid/map';
import { createGameSystems } from '../../src/sim/systems';

export const realMap = loadMap(mapData);

export function shopSim(seed = 'shop'): Simulation {
  return Simulation.create(seed, createGameSystems(realMap));
}

/** As primeiras `count` casas onde dá para construir. */
export function freeCells(count: number): GridCoord[] {
  const cells: GridCoord[] = [];
  for (let y = 0; y < realMap.height && cells.length < count; y++) {
    for (let x = 0; x < realMap.width && cells.length < count; x++) {
      if (realMap.canPlaceTower({ x, y })) cells.push({ x, y });
    }
  }
  return cells;
}

/** Um tick com os eventos que ele emitiu. */
export function stepOnce(sim: Simulation): SimEvent[] {
  sim.step();
  return sim.drainEvents();
}
