/**
 * Lista dos sistemas da partida, na ordem em que rodam a cada tick:
 * ações → reposição do estresse → movimento → chegada ao núcleo →
 * ataque do núcleo → projéteis → torres → gatilhos → classes.
 *
 * Todo spawn acontece antes do movimento e toda busca por alvo depois dele:
 * é o que permite montar o índice espacial uma única vez por tick. O índice
 * é compartilhado pelo núcleo, pelos projéteis (troca de alvo e área),
 * pelas torres e pelos gatilhos.
 *
 * Os gatilhos enxergam todos os tiros e abates do tick. As classes rodam por
 * último: o bônus muda no tick seguinte a posicionar, vender ou fundir.
 */

import engineConfig from '../data/engine.json';
import { classData, type ClassData } from './classes/classData';
import { createClassSystem } from './classes/systems';
import { enemyData, type EnemyData } from './enemies/enemyData';
import { buildRoutes } from './enemies/route';
import { createCommandSystem } from './commands';
import { simDebugData, type SimDebugData } from './debug/debugData';
import { createStressSystem } from './debug/stress';
import { createMovementSystem } from './enemies/systems';
import type { System } from './engine/simulation';
import type { GridMap } from './grid/map';
import { nexusData, type NexusData } from './nexus/nexusData';
import { createNexusAttackSystem, createNexusContactSystem } from './nexus/systems';
import { createProjectileSystem } from './projectiles/systems';
import { SpatialIndex } from './spatial/spatialIndex';
import { createTargetScores } from './towers/targeting';
import { towerData, type TowerData } from './towers/towerData';
import { createTowerSystem } from './towers/systems';
import { createTriggerSystem } from './triggers/engine';

export interface GameSystemsOptions {
  enemies?: EnemyData;
  nexus?: NexusData;
  towers?: TowerData;
  classes?: ClassData;
  debug?: SimDebugData;
  ticksPerSecond?: number;
}

export function createGameSystems(map: GridMap, options: GameSystemsOptions = {}): System[] {
  const {
    enemies = enemyData,
    nexus = nexusData,
    towers = towerData,
    classes = classData,
    debug = simDebugData,
    ticksPerSecond = engineConfig.ticksPerSecond,
  } = options;
  const routes = buildRoutes(map);
  const index = new SpatialIndex(engineConfig.spatialCellSize);
  const scores = createTargetScores(routes, enemies);
  return [
    createCommandSystem(map, routes, enemies, towers, debug),
    createStressSystem(routes, enemies),
    createMovementSystem(routes, enemies, ticksPerSecond),
    createNexusContactSystem(routes, enemies),
    createNexusAttackSystem(map.nexus, enemies, nexus, ticksPerSecond, index),
    createProjectileSystem(enemies, index, towers.projectileRetargetRadius, ticksPerSecond),
    createTowerSystem(index, towers, scores, ticksPerSecond, classes),
    createTriggerSystem({ index, enemies, towers, classes, scores, ticksPerSecond }),
    createClassSystem(towers, classes),
  ];
}
