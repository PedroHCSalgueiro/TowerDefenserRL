/**
 * Cenários dos marcos da curva (T21): torres fixas, sem loja, numa onda
 * escolhida. A torre vai para a casa que mais vê o caminho com o alcance dela.
 * Sem recompensas (T24): os marcos medem só as torres.
 */

import { Simulation } from '../../src/sim/engine/simulation';
import type { GridCoord } from '../../src/sim/grid/map';
import { createGameSystems } from '../../src/sim/systems';
import { towerData } from '../../src/sim/towers/towerData';
import { botMap, noRewards, playWave, type WaveReport } from './waveBot';

/** Casas de torre ordenadas pela quantidade de casas do caminho dentro de `range`. */
export function cellsByCoverage(range: number): GridCoord[] {
  const cells: { cell: GridCoord; score: number }[] = [];
  for (let y = 0; y < botMap.height; y++) {
    for (let x = 0; x < botMap.width; x++) {
      if (!botMap.canPlaceTower({ x, y })) continue;
      const score = botMap.pathCells.filter((p) => Math.hypot(p.x - x, p.y - y) <= range).length;
      cells.push({ cell: { x, y }, score });
    }
  }
  return cells.sort((a, b) => b.score - a.score).map((c) => c.cell);
}

export interface Placed {
  readonly type: string;
  readonly star?: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Coloca as torres (debug, ★ pedida) e joga a onda `wave` sozinha. O
 * relatório diz se o núcleo sofreu dano (`nexusHp`) e se a onda fechou.
 */
export function playMilestone(
  wave: number,
  towers: readonly Placed[],
): WaveReport & { maxNexusHp: number; won: boolean } {
  const sim = Simulation.create(`marco-${wave}`, createGameSystems(botMap, { rewards: noRewards }));
  sim.enqueue({ type: 'debugSkipToWave', wave });
  for (const t of towers) {
    sim.enqueue({ type: 'placeTower', towerType: t.type, x: t.x, y: t.y, star: t.star ?? 1 });
  }
  sim.step();
  sim.drainEvents();
  const report = playWave(sim);
  return {
    ...report,
    maxNexusHp: sim.state.nexus.maxHp,
    won: sim.state.status !== 'lost' && sim.state.wave === wave,
  };
}

/** Uma torre do tipo, sozinha, na melhor casa para o alcance dela. */
export function alone(type: string): Placed {
  const cell = cellsByCoverage(towerData.types[type]!.range)[0]!;
  return { type, ...cell };
}
