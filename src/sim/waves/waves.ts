/**
 * Ondas: chamar a próxima, fazer nascer os inimigos na hora certa, fechar a
 * onda quando ela acaba e declarar a vitória no fim da última.
 *
 * O fim da onda chama o mesmo `endWave` da economia (juros, bônus e loja
 * nova) que o botão "Encerrar onda" do debug.
 */

import { endWave } from '../economy/economy';
import type { EconomyData } from '../economy/economyData';
import { getEnemyType, type EnemyData } from '../enemies/enemyData';
import { releaseAllEnemies } from '../enemies/pool';
import type { Routes } from '../enemies/route';
import { spawnEnemy } from '../enemies/systems';
import type { System, TickContext } from '../engine/simulation';
import { releaseAllProjectiles } from '../projectiles/pool';
import type { RunState } from '../state';
import type { TowerData } from '../towers/towerData';
import type { WaveSchedule } from './schedule';

/**
 * Por que a onda não pode ser chamada agora: `over` = run encerrada ou sem
 * ondas restantes; `active` = há uma onda em andamento; `enemies` = ainda há
 * inimigo vivo no mapa (o empilhamento é da T14).
 */
export type CallWaveRefusal = 'over' | 'active' | 'enemies';

export function callWaveRefusal(
  state: Readonly<RunState>,
  totalWaves: number,
): CallWaveRefusal | null {
  if (state.status !== 'playing' || state.wave >= totalWaves) return 'over';
  if (state.waves.active) return 'active';
  if (state.enemies.activeCount > 0) return 'enemies';
  return null;
}

/** Inimigos da onda em andamento que ainda não nasceram ou ainda estão vivos (0 sem onda). */
export function waveRemaining(
  state: Readonly<RunState>,
  schedules: readonly WaveSchedule[],
): number {
  if (!state.waves.active) return 0;
  const schedule = schedules[state.wave];
  const unspawned = schedule ? schedule.entries.length - state.waves.spawned : 0;
  return unspawned + state.enemies.activeCount;
}

/** Ação do jogador: começa a próxima onda, se o mapa estiver limpo. */
export function callWave(ctx: TickContext, schedules: readonly WaveSchedule[]): void {
  const { state } = ctx;
  const reason = callWaveRefusal(state, schedules.length);
  if (reason !== null) {
    ctx.emit({ type: 'callWaveRefused', tick: state.tick, reason });
    return;
  }
  state.waves = { active: true, startTick: state.tick, spawned: 0, bossesKilled: 0 };
  ctx.emit({ type: 'waveStarted', tick: state.tick, wave: state.wave + 1 });
}

/**
 * Debug ("Encerrar onda"): com onda em andamento, tira do mapa os inimigos e
 * projéteis (sem ouro de abate) e esquece os nascimentos que faltam; depois
 * fecha a onda pelo `endWave`. Depois da última onda, não faz nada.
 */
export function forceEndWave(
  ctx: TickContext,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
): void {
  const { state } = ctx;
  if (state.wave >= schedules.length) return;
  if (state.waves.active) {
    releaseAllEnemies(state.enemies);
    releaseAllProjectiles(state.projectiles);
    state.waves.active = false;
  }
  endWave(ctx, economy, towers);
}

/**
 * Debug ("Pular para onda"): entre ondas, fecha ondas pelo `endWave` (com
 * juros, bônus e loja nova de cada uma) até a próxima a chamar ser `target`.
 */
export function skipToWave(
  ctx: TickContext,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
  target: number,
): void {
  const { state } = ctx;
  if (state.waves.active || !Number.isFinite(target)) return;
  const last = Math.min(Math.floor(target), schedules.length) - 1;
  while (state.wave < last) endWave(ctx, economy, towers);
}

/**
 * Nascimentos da onda em andamento, logo depois das ações: todo inimigo cujo
 * tick já chegou nasce na entrada, com a vida multiplicada pelo
 * `hpMultiplier` da onda (o chefão fica com a vida dos dados).
 */
export function createWaveSpawnSystem(
  routes: Routes,
  enemies: EnemyData,
  schedules: readonly WaveSchedule[],
): System {
  return (ctx) => {
    const { state } = ctx;
    const waves = state.waves;
    if (!waves.active || state.status !== 'playing') return;
    const schedule = schedules[state.wave];
    if (!schedule) return;
    const elapsed = state.tick - waves.startTick;
    const { entries } = schedule;
    while (waves.spawned < entries.length && entries[waves.spawned]!.tick <= elapsed) {
      const { type } = entries[waves.spawned]!;
      const multiplier = getEnemyType(enemies, type).boss ? 1 : schedule.hpMultiplier;
      spawnEnemy(ctx, routes, enemies, type, 0, multiplier);
      waves.spawned++;
    }
  };
}

/**
 * Depois do ouro: conta os abates do tick e fecha a onda quando todos os
 * inimigos dela já nasceram e nenhum está vivo. No fim da última onda, com
 * os chefões mortos, a run é vencida (depois do `endWave`).
 */
export function createWaveProgressSystem(
  enemies: EnemyData,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
): System {
  // Calculado só quando uma onda fecha: partidas de teste com outros tipos de
  // inimigo e sem ondas nunca consultam a lista padrão.
  const countBosses = (schedule: WaveSchedule | undefined): number =>
    schedule?.entries.filter((e) => getEnemyType(enemies, e.type).boss).length ?? 0;
  return (ctx) => {
    const { state } = ctx;
    const waves = state.waves;
    for (const event of ctx.tickEvents) {
      if (event.type !== 'enemyKilled') continue;
      state.stats.kills++;
      if (waves.active && getEnemyType(enemies, event.enemyType).boss) waves.bossesKilled++;
    }
    if (!waves.active || state.status !== 'playing') return;
    const schedule = schedules[state.wave];
    if (schedule && waves.spawned < schedule.entries.length) return;
    if (state.enemies.activeCount > 0) return;
    waves.active = false;
    const bossesKilled = waves.bossesKilled;
    const bossCount = countBosses(schedule);
    endWave(ctx, economy, towers);
    if (state.wave === schedules.length && bossesKilled >= bossCount) {
      state.status = 'won';
      ctx.emit({ type: 'runWon', tick: state.tick, wave: state.wave });
    }
  };
}
