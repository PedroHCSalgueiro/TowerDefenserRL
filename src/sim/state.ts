/**
 * Estado completo da run. Tudo aqui precisa caber em JSON: é a base do save
 * no meio da run. As próximas tarefas acrescentam torres, ondas, ouro etc.
 */

import engineConfig from '../data/engine.json';
import type { DummyTower } from './debug/dummyTowers';
import { createEnemyPool, type EnemyPool } from './enemies/pool';
import { hashSeed } from './engine/rng';
import { nexusData } from './nexus/nexusData';
import { createProjectilePool, type ProjectilePool } from './projectiles/pool';

export const RUN_STATE_VERSION = 3;

/**
 * Disposição usada pelo debug:
 * - `spread`: inimigos em pontos sorteados ao longo da rota; torres ao longo do caminho.
 * - `clustered`: inimigos na entrada; torres nas casas mais próximas da entrada.
 */
export type DebugLayout = 'spread' | 'clustered';

/** Ação do debug: coloca um inimigo do tipo pedido na entrada. */
export interface SpawnEnemyCommand {
  type: 'spawnEnemy';
  enemyType: string;
}

/** Debug: N inimigos de um tipo (ou de tipos sorteados, se `enemyType` for `null`). */
export interface DebugSpawnEnemiesCommand {
  type: 'debugSpawnEnemies';
  count: number;
  enemyType: string | null;
  layout: DebugLayout;
}

/** Debug: N torres de teste (provisórias; a T06 as substitui). */
export interface DebugSpawnTowersCommand {
  type: 'debugSpawnTowers';
  count: number;
  layout: DebugLayout;
}

/** Debug: remove inimigos, projéteis e torres de teste, e desliga o estresse. */
export interface DebugClearCommand {
  type: 'debugClear';
}

/** Debug: liga (`stress` preenchido) ou desliga (`null`) o modo estresse. */
export interface DebugSetStressCommand {
  type: 'debugSetStress';
  stress: StressConfig | null;
}

export interface DebugSetNexusInvulnerableCommand {
  type: 'debugSetNexusInvulnerable';
  value: boolean;
}

/** Ação do jogador, aplicada no início do próximo tick. */
export type SimCommand =
  | SpawnEnemyCommand
  | DebugSpawnEnemiesCommand
  | DebugSpawnTowersCommand
  | DebugClearCommand
  | DebugSetStressCommand
  | DebugSetNexusInvulnerableCommand;

/** Modo estresse: mantém `count` inimigos ativos, repondo quem morre ou chega. */
export interface StressConfig {
  count: number;
  layout: DebugLayout;
}

export interface DebugState {
  /** O núcleo não perde vida (e a run não termina). */
  nexusInvulnerable: boolean;
  stress: StressConfig | null;
  towers: DummyTower[];
}

export type RunStatus = 'playing' | 'lost';

export interface NexusState {
  hp: number;
  maxHp: number;
  /** Ticks até o próximo ataque; 0 = pronto. */
  attackCooldownTicks: number;
}

export interface RunState {
  version: number;
  seed: string;
  tick: number;
  rngState: number;
  nextEntityId: number;
  status: RunStatus;
  nexus: NexusState;
  enemies: EnemyPool;
  projectiles: ProjectilePool;
  debug: DebugState;
  /** Ações enfileiradas que ainda não foram aplicadas. */
  commandQueue: SimCommand[];
}

export function createRunState(seed: string): RunState {
  return {
    version: RUN_STATE_VERSION,
    seed,
    tick: 0,
    rngState: hashSeed(seed),
    nextEntityId: 1,
    status: 'playing',
    nexus: { hp: nexusData.maxHp, maxHp: nexusData.maxHp, attackCooldownTicks: 0 },
    enemies: createEnemyPool(engineConfig.enemyPoolInitialCapacity),
    projectiles: createProjectilePool(engineConfig.projectilePoolInitialCapacity),
    debug: { nexusInvulnerable: false, stress: null, towers: [] },
    commandQueue: [],
  };
}

export function serializeRunState(state: RunState): string {
  return JSON.stringify(state);
}

export function deserializeRunState(json: string): RunState {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null) {
    throw new Error('Save inválido: não é um objeto');
  }
  const state = data as Partial<RunState>;
  if (state.version !== RUN_STATE_VERSION) {
    throw new Error(`Versão de save não suportada: ${String(state.version)}`);
  }
  const { nexus, enemies, projectiles, debug } = state;
  if (
    typeof state.seed !== 'string' ||
    !Number.isInteger(state.tick) ||
    !Number.isInteger(state.rngState) ||
    !Number.isInteger(state.nextEntityId) ||
    (state.status !== 'playing' && state.status !== 'lost') ||
    typeof nexus?.hp !== 'number' ||
    typeof nexus.maxHp !== 'number' ||
    !Number.isInteger(nexus.attackCooldownTicks) ||
    !Array.isArray(enemies?.slots) ||
    !Array.isArray(enemies.free) ||
    !Number.isInteger(enemies.activeCount) ||
    !Array.isArray(projectiles?.slots) ||
    !Array.isArray(projectiles.free) ||
    !Number.isInteger(projectiles.activeCount) ||
    typeof debug?.nexusInvulnerable !== 'boolean' ||
    (debug.stress !== null && typeof debug.stress !== 'object') ||
    !Array.isArray(debug.towers) ||
    !Array.isArray(state.commandQueue)
  ) {
    throw new Error('Save inválido: campos ausentes ou com tipo errado');
  }
  return state as RunState;
}
