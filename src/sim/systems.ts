/**
 * Lista dos sistemas da partida, na ordem em que rodam a cada tick:
 * relógio da recompensa → ações → tempo esgotado da recompensa →
 * nascimentos das ondas → reposição do estresse → movimento → chegada ao
 * núcleo → ataque do núcleo → projéteis → torres → gatilhos → ouro → fim
 * da onda → abertura da recompensa → classes.
 *
 * Com a tela de recompensa aberta (T24), o tick é congelado: só rodam os
 * sistemas da recompensa, as ações, o ouro e as classes (`runsWhileFrozen`).
 *
 * Todo spawn acontece antes do movimento e toda busca por alvo depois dele:
 * é o que permite montar o índice espacial uma única vez por tick. O índice
 * é compartilhado pelo núcleo, pelos projéteis (troca de alvo e área),
 * pelas torres e pelos gatilhos.
 *
 * Os gatilhos enxergam todos os tiros e abates do tick; o ouro dos abates é
 * somado depois deles, e só então a onda pode fechar (os juros já contam o
 * ouro do último abate). As classes rodam por
 * último: o bônus muda no tick seguinte a posicionar, vender ou fundir.
 */

import engineConfig from '../data/engine.json';
import { classData, type ClassData } from './classes/classData';
import { createGoldSystem } from './economy/economy';
import { economyData, type EconomyData } from './economy/economyData';
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
import { buildWaveSchedules } from './waves/schedule';
import { waveData, type WaveData } from './waves/waveData';
import { createWaveProgressSystem, createWaveSpawnSystem } from './waves/waves';
import { rewardData, type RewardData } from './rewards/rewardData';
import {
  createRewardClockSystem,
  createRewardOpenSystem,
  createRewardTimeoutSystem,
} from './rewards/rewards';

export interface GameSystemsOptions {
  enemies?: EnemyData;
  nexus?: NexusData;
  towers?: TowerData;
  classes?: ClassData;
  debug?: SimDebugData;
  economy?: EconomyData;
  waves?: WaveData;
  /** Recompensas de escolha (T24); com `waves` vazio, nenhuma tela abre. */
  rewards?: RewardData;
  ticksPerSecond?: number;
}

export function createGameSystems(map: GridMap, options: GameSystemsOptions = {}): System[] {
  const {
    enemies = enemyData,
    nexus = nexusData,
    towers = towerData,
    classes = classData,
    debug = simDebugData,
    economy = economyData,
    waves = waveData,
    rewards = rewardData,
    ticksPerSecond = engineConfig.ticksPerSecond,
  } = options;
  const routes = buildRoutes(map);
  const index = new SpatialIndex(engineConfig.spatialCellSize);
  const scores = createTargetScores(routes, enemies);
  const schedules = buildWaveSchedules(waves, ticksPerSecond);
  return [
    createRewardClockSystem(),
    createCommandSystem(
      map,
      routes,
      enemies,
      towers,
      debug,
      schedules,
      economy,
      nexus,
      rewards,
      classes,
      ticksPerSecond,
    ),
    createRewardTimeoutSystem(rewards),
    createWaveSpawnSystem(routes, enemies, schedules, waves.maxActiveEnemies),
    createStressSystem(routes, enemies),
    createMovementSystem(routes, enemies, ticksPerSecond),
    createNexusContactSystem(routes, enemies),
    createNexusAttackSystem(map.nexus, enemies, nexus, ticksPerSecond, index),
    createProjectileSystem(enemies, index, towers.projectileRetargetRadius, ticksPerSecond),
    createTowerSystem(index, towers, scores, ticksPerSecond, classes),
    createTriggerSystem({ index, enemies, towers, classes, scores, ticksPerSecond }),
    createGoldSystem(enemies),
    createWaveProgressSystem(enemies, schedules, economy, towers),
    createRewardOpenSystem(rewards, economy, classes, ticksPerSecond),
    createClassSystem(towers, classes),
  ];
}
