/**
 * Aplica as ações da fila, na ordem em que foram enfileiradas, no início do
 * tick. É o único lugar em que ações do jogador e do debug mudam o estado.
 * Qualquer comando de debug liga `cheated` (T17), mesmo se for recusado.
 */

import type { SimDebugData } from './debug/debugData';
import { economyData, type EconomyData } from './economy/economyData';
import { spawnDebugEnemy } from './debug/stress';
import { CHEAT_COMMAND_TYPES } from './state';
import { patternTowerType, pickTowerCells } from './debug/towerCells';
import type { EnemyData } from './enemies/enemyData';
import { releaseAllEnemies } from './enemies/pool';
import type { Routes } from './enemies/route';
import { spawnEnemy } from './enemies/systems';
import type { System } from './engine/simulation';
import type { GridMap } from './grid/map';
import { evolveNexus } from './nexus/evolve';
import { nexusData, type NexusData } from './nexus/nexusData';
import { releaseAllProjectiles } from './projectiles/pool';
import { buyTower, rerollShop, sellTower } from './shop/shop';
import { moveTower } from './towers/move';
import { placeTower } from './towers/placement';
import type { TowerData } from './towers/towerData';
import type { WaveSchedule } from './waves/schedule';
import { callWave, forceEndWave, skipToWave } from './waves/waves';

export function createCommandSystem(
  map: GridMap,
  routes: Routes,
  enemies: EnemyData,
  towers: TowerData,
  debug: SimDebugData,
  schedules: readonly WaveSchedule[],
  economy: EconomyData = economyData,
  nexus: NexusData = nexusData,
): System {
  /** Quantidade pedida, presa em [0, maxSpawnPerCommand]. */
  const clampCount = (count: number): number =>
    Number.isFinite(count) ? Math.min(Math.max(0, Math.floor(count)), debug.maxSpawnPerCommand) : 0;

  /** Ouro da trapaça: inteiro, entre 0 e `maxGoldPerCommand`. */
  const clampGold = (amount: number): number =>
    Number.isFinite(amount)
      ? Math.min(Math.max(0, Math.floor(amount)), debug.maxGoldPerCommand)
      : 0;

  return (ctx) => {
    const { state } = ctx;
    for (const command of ctx.commands) {
      if (CHEAT_COMMAND_TYPES.has(command.type)) state.cheated = true;
      switch (command.type) {
        case 'spawnEnemy':
          spawnEnemy(ctx, routes, enemies, command.enemyType);
          break;
        case 'placeTower':
          placeTower(ctx, map, towers, command.towerType, command, command.star);
          break;
        case 'buyTower':
          buyTower(
            ctx,
            map,
            towers,
            economy,
            nexus,
            command.slot,
            command.x === undefined || command.y === undefined
              ? undefined
              : { x: command.x, y: command.y },
          );
          break;
        case 'rerollShop':
          rerollShop(ctx, towers, economy);
          break;
        case 'sellTower':
          sellTower(ctx, economy, command.towerId);
          break;
        case 'moveTower':
          moveTower(ctx, map, command.towerId, { x: command.x, y: command.y });
          break;
        case 'evolveNexus':
          evolveNexus(ctx, nexus);
          break;
        case 'callWave':
          callWave(ctx, schedules, enemies, economy);
          break;
        case 'endWave':
          forceEndWave(ctx, schedules, economy, towers);
          break;
        case 'debugSkipToWave':
          skipToWave(ctx, schedules, economy, towers, command.wave);
          break;
        case 'debugSpawnEnemies': {
          const count = clampCount(command.count);
          for (let i = 0; i < count; i++) {
            spawnDebugEnemy(ctx, routes, enemies, command.enemyType, command.layout);
          }
          break;
        }
        case 'debugSpawnTowers': {
          const occupied = new Set(state.towers.map((t) => map.indexOf(t)));
          const cells = pickTowerCells(map, occupied, clampCount(command.count), command.layout);
          for (const cell of cells) {
            const towerType = patternTowerType(command.towerTypes, cell);
            if (towerType !== null) placeTower(ctx, map, towers, towerType, cell, command.star);
          }
          break;
        }
        case 'debugClear':
          releaseAllEnemies(state.enemies);
          releaseAllProjectiles(state.projectiles);
          state.towers = [];
          state.triggers.queue = [];
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
        case 'debugAddGold':
          // Fora do ouro ganho da run (`stats.goldEarned`).
          state.gold += clampGold(command.amount);
          break;
        case 'debugSetInfiniteGold':
          state.debug.infiniteGold = command.value;
          break;
      }
    }
  };
}
