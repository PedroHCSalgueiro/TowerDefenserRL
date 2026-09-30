/**
 * Estado completo da run. Tudo aqui precisa caber em JSON: é a base do save
 * no meio da run. As próximas tarefas acrescentam ondas etc.
 */

import engineConfig from '../data/engine.json';
import { classData } from './classes/classData';
import { economyData } from './economy/economyData';
import { createClassState, type ClassState } from './classes/classState';
import { createEnemyPool, type EnemyPool } from './enemies/pool';
import { Rng, hashSeed } from './engine/rng';
import { nexusData } from './nexus/nexusData';
import { createProjectilePool, type ProjectilePool } from './projectiles/pool';
import { newShop, type ShopState } from './shop/shop';
import type { Tower } from './towers/placement';
import { towerData } from './towers/towerData';
import { createTriggerState, type TriggerState } from './triggers/triggerState';

export const RUN_STATE_VERSION = 8;

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

/** Ação do jogador: posiciona uma torre do tipo pedido na casa (x, y). */
export interface PlaceTowerCommand {
  type: 'placeTower';
  towerType: string;
  x: number;
  y: number;
  /** Só para o debug (padrão 1): a estrela real vem da fusão, na T11. */
  star?: number;
}

/** Debug: N inimigos de um tipo (ou de tipos sorteados, se `enemyType` for `null`). */
export interface DebugSpawnEnemiesCommand {
  type: 'debugSpawnEnemies';
  count: number;
  enemyType: string | null;
  layout: DebugLayout;
}

/**
 * Debug: N torres em casas livres escolhidas pela disposição. Com um tipo só,
 * todas iguais; com vários, o tipo de cada casa sai do padrão de
 * `patternTowerType` (cada torre encosta nos outros tipos).
 */
export interface DebugSpawnTowersCommand {
  type: 'debugSpawnTowers';
  count: number;
  towerTypes: string[];
  layout: DebugLayout;
  /** Estrela das torres (padrão 1), presa ao máximo de cada tipo. */
  star?: number;
}

/** Debug: remove inimigos, projéteis e torres, e desliga o estresse. */
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

/**
 * Ação do jogador: compra o slot da loja. Se a cópia funde com uma torre do
 * mapa (T11), funde na hora e a casa não é usada; senão posiciona a torre na
 * casa (x, y), que passa a ser obrigatória. O ouro só é cobrado se a compra
 * der certo.
 */
export interface BuyTowerCommand {
  type: 'buyTower';
  slot: number;
  x?: number;
  y?: number;
}

/** Ação do jogador: troca os slots da loja pagando o reroll. */
export interface RerollShopCommand {
  type: 'rerollShop';
}

/** Ação do jogador: vende a torre, devolvendo parte do valor investido. */
export interface SellTowerCommand {
  type: 'sellTower';
  towerId: number;
}

/**
 * Fecha a onda atual: juros, bônus e loja nova. Enquanto não há ondas, é o
 * botão "Encerrar onda" do debug.
 */
export interface EndWaveCommand {
  type: 'endWave';
}

/** Ação do jogador, aplicada no início do próximo tick. */
export type SimCommand =
  | SpawnEnemyCommand
  | PlaceTowerCommand
  | BuyTowerCommand
  | RerollShopCommand
  | SellTowerCommand
  | EndWaveCommand
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
}

export type RunStatus = 'playing' | 'lost';

export interface NexusState {
  hp: number;
  maxHp: number;
  /** Ticks até o próximo ataque; 0 = pronto. */
  attackCooldownTicks: number;
  /** Nível do núcleo (define as chances de raridade da loja). Sobe na tarefa do núcleo. */
  level: number;
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
  /** Torres no mapa, na ordem em que foram posicionadas (é a ordem de disparo). */
  towers: Tower[];
  /** Motor de gatilhos: fila pendente, ordem de disparo e contadores. */
  triggers: TriggerState;
  /** Contagem e nível de bônus de cada classe (atualizado no fim de cada tick). */
  classes: ClassState;
  /** Ouro guardado. */
  gold: number;
  /** Último saldo informado em `goldChanged` (para emitir no máximo um por tick). */
  reportedGold: number;
  /** Ondas encerradas até agora (a primeira a fechar é a 1). */
  wave: number;
  shop: ShopState;
  debug: DebugState;
  /** Ações enfileiradas que ainda não foram aplicadas. */
  commandQueue: SimCommand[];
}

export function createRunState(seed: string): RunState {
  const state: RunState = {
    version: RUN_STATE_VERSION,
    seed,
    tick: 0,
    rngState: hashSeed(seed),
    nextEntityId: 1,
    status: 'playing',
    nexus: {
      hp: nexusData.maxHp,
      maxHp: nexusData.maxHp,
      attackCooldownTicks: 0,
      level: economyData.nexusStartLevel,
    },
    enemies: createEnemyPool(engineConfig.enemyPoolInitialCapacity),
    projectiles: createProjectilePool(engineConfig.projectilePoolInitialCapacity),
    towers: [],
    triggers: createTriggerState(),
    classes: createClassState(classData),
    gold: economyData.startingGold,
    reportedGold: economyData.startingGold,
    wave: 0,
    shop: { slots: [] },
    debug: { nexusInvulnerable: false, stress: null },
    commandQueue: [],
  };
  // A primeira loja da run sai do RNG da própria semente e garante uma comum.
  state.shop = newShop(new Rng(state), economyData, towerData, state.nexus.level, true);
  return state;
}

export function serializeRunState(state: RunState): string {
  return JSON.stringify(state);
}

function isTowerState(value: unknown): boolean {
  const t = value as Partial<Tower> | null;
  return (
    typeof t === 'object' &&
    t !== null &&
    Number.isInteger(t.id) &&
    Number.isInteger(t.star) &&
    Number.isInteger(t.invested) &&
    typeof t.type === 'string' &&
    Number.isInteger(t.cooldownTicks) &&
    Number.isInteger(t.triggerCounter) &&
    typeof t.charges === 'number' &&
    Number.isInteger(t.activationReadyTick) &&
    (t.lastEffect === null || typeof t.lastEffect === 'object')
  );
}

function isClassState(value: unknown): value is ClassState {
  if (typeof value !== 'object' || value === null) return false;
  return classData.ids.every((id) => {
    const status = (value as Record<string, Partial<ClassState[string]> | undefined>)[id];
    return (
      typeof status === 'object' &&
      status !== null &&
      Number.isInteger(status.level) &&
      Array.isArray(status.members)
    );
  });
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
  const { nexus, enemies, projectiles, towers, triggers, classes, debug, shop } = state;
  if (
    typeof state.seed !== 'string' ||
    !Number.isInteger(state.tick) ||
    !Number.isInteger(state.rngState) ||
    !Number.isInteger(state.nextEntityId) ||
    (state.status !== 'playing' && state.status !== 'lost') ||
    typeof nexus?.hp !== 'number' ||
    typeof nexus.maxHp !== 'number' ||
    !Number.isInteger(nexus.attackCooldownTicks) ||
    !Number.isInteger(nexus.level) ||
    !Number.isInteger(state.gold) ||
    !Number.isInteger(state.reportedGold) ||
    !Number.isInteger(state.wave) ||
    !Array.isArray(shop?.slots) ||
    !shop.slots.every((slot) => slot === null || typeof slot === 'string') ||
    !Array.isArray(enemies?.slots) ||
    !Array.isArray(enemies.free) ||
    !Number.isInteger(enemies.activeCount) ||
    !Array.isArray(projectiles?.slots) ||
    !Array.isArray(projectiles.free) ||
    !Number.isInteger(projectiles.activeCount) ||
    !Array.isArray(towers) ||
    !towers.every(isTowerState) ||
    !Array.isArray(triggers?.queue) ||
    !Number.isInteger(triggers.nextSeq) ||
    typeof triggers.lastTick !== 'object' ||
    triggers.lastTick === null ||
    !Number.isInteger(triggers.droppedTotal) ||
    !isClassState(classes) ||
    typeof debug?.nexusInvulnerable !== 'boolean' ||
    (debug.stress !== null && typeof debug.stress !== 'object') ||
    !Array.isArray(state.commandQueue)
  ) {
    throw new Error('Save inválido: campos ausentes ou com tipo errado');
  }
  return state as RunState;
}
