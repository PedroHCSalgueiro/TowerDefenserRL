/**
 * Aplica as ações da fila, na ordem em que foram enfileiradas, no início do
 * tick. É o único lugar em que ações do jogador e do debug mudam o estado.
 */

import { pickTowerCells } from './debug/dummyTowers';
import type { SimDebugData } from './debug/debugData';
import { spawnDebugEnemy } from './debug/stress';
import type { EnemyData } from './enemies/enemyData';
import { releaseAllEnemies } from './enemies/pool';
import type { Routes } from './enemies/route';
import { spawnEnemy } from './enemies/systems';
import type { System } from './engine/simulation';
import type { GridMap } from './grid/map';
import { releaseAllProjectiles } from './projectiles/pool';

export function createCommandSystem(
  map: GridMap,
  routes: Routes,
  enemies: EnemyData,
  debug: SimDebugData,
): System {
  /** Quantidade pedida, presa em [0, maxSpawnPerCommand]. */
  const clampCount = (count: number): number =>
    Number.isFinite(count) ? Math.min(Math.max(0, Math.floor(count)), debug.maxSpawnPerCommand) : 0;

  return (ctx) => {
    const { state } = ctx;
    for (const command of ctx.commands) {
      switch (command.type) {
        case 'spawnEnemy':
          spawnEnemy(ctx, routes, enemies, command.enemyType);
          break;
        case 'debugSpawnEnemies': {
          const count = clampCount(command.count);
          for (let i = 0; i < count; i++) {
            spawnDebugEnemy(ctx, routes, enemies, command.enemyType, command.layout);
          }
          break;
        }
        case 'debugSpawnTowers': {
          const occupied = new Set(state.debug.towers.map((t) => map.indexOf(t)));
          const cells = pickTowerCells(map, occupied, clampCount(command.count), command.layout);
          for (const cell of cells) {
            state.debug.towers.push({
              id: ctx.allocateId(),
              x: cell.x,
              y: cell.y,
              cooldownTicks: 0,
            });
          }
          break;
        }
        case 'debugClear':
          releaseAllEnemies(state.enemies);
          releaseAllProjectiles(state.projectiles);
          state.debug.towers = [];
          state.debug.stress = null;
          break;
        case 'debugSetStress':
          state.debug.stress = command.stress && {
            count: clampCount(command.stress.count),
            layout: command.stress.layout,
          };
          break;
        case 'debugSetNexusInvulnerable':
          state.debug.nexusInvulnerable = command.value;
          break;
      }
    }
  };
}
