/**
 * Ondas: chamar a próxima (inclusive antecipada, com outras em andamento),
 * fazer nascer os inimigos na hora certa, fechar as ondas em ordem quando
 * acabam e declarar a vitória no fim da última.
 *
 * Cada inimigo pertence à sua onda (`Enemy.wave`). Cada onda fecha pelo
 * mesmo `endWave` da economia (juros, bônus, bônus antecipado e loja nova)
 * que o botão "Encerrar onda" do debug.
 */

import { earlyBonusFor, endWave } from '../economy/economy';
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
import { nextWaveNumber, type ActiveWave } from './waveState';

/**
 * Por que a onda não pode ser chamada agora: `over` = run encerrada ou sem
 * ondas restantes. Só a onda com chefão exige o mapa limpo: `active` = há
 * onda em andamento; `enemies` = ainda há inimigo vivo no mapa.
 */
export type CallWaveRefusal = 'over' | 'active' | 'enemies';

const bossCountCache = new WeakMap<WaveSchedule, number>();

/**
 * Chefões na lista da onda. Calculado só quando é preciso: partidas de teste
 * com outros tipos de inimigo e sem ondas nunca consultam a lista padrão.
 */
export function bossCountOf(schedule: WaveSchedule, enemies: EnemyData): number {
  let count = bossCountCache.get(schedule);
  if (count === undefined) {
    count = schedule.entries.filter((e) => getEnemyType(enemies, e.type).boss).length;
    bossCountCache.set(schedule, count);
  }
  return count;
}

export function callWaveRefusal(
  state: Readonly<RunState>,
  schedules: readonly WaveSchedule[],
  enemies: EnemyData,
): CallWaveRefusal | null {
  const next = nextWaveNumber(state);
  const schedule = schedules[next - 1];
  if (state.status !== 'playing' || !schedule) return 'over';
  if (bossCountOf(schedule, enemies) > 0) {
    if (state.waves.active.length > 0) return 'active';
    if (state.enemies.activeCount > 0) return 'enemies';
  }
  return null;
}

export type WaveKind = 'normal' | 'elite' | 'boss';

/** Tipo da onda pelos dados: com chefão é `boss` (mesmo com elites), com elite é `elite`. */
export function waveKindOf(schedule: WaveSchedule, enemies: EnemyData): WaveKind {
  if (bossCountOf(schedule, enemies) > 0) return 'boss';
  return schedule.entries.some((e) => e.elite) ? 'elite' : 'normal';
}

export interface EarlyBonusWindow {
  /** Ainda dá bônus chamar agora (menos de `windowPercent` da onda mais recente nasceu). */
  readonly open: boolean;
  /** Nascimentos da onda mais recente que faltam para a janela fechar (0 = fechada). */
  readonly remaining: number;
  /** Fração da janela já gasta, de 0 a 1 (para a barra do botão). */
  readonly spent: number;
}

/**
 * Janela do bônus de chamada antecipada (T23), contada pelos nascimentos da
 * onda mais recente em andamento. `null` sem onda ativa (a chamada não é antecipada).
 */
export function earlyBonusWindow(
  state: Readonly<RunState>,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
): EarlyBonusWindow | null {
  const newest = state.waves.active[state.waves.active.length - 1];
  if (!newest) return null;
  const total = schedules[newest.wave - 1]?.entries.length ?? 0;
  const percent = economy.earlyCall.windowPercent;
  // Fecha no primeiro nascimento que leva a onda a `percent`% ou mais.
  const closesAt = Math.ceil((total * percent) / 100);
  const remaining = Math.max(0, closesAt - newest.spawned);
  return {
    open: newest.spawned * 100 < total * percent,
    remaining,
    spent: closesAt > 0 ? Math.min(1, newest.spawned / closesAt) : 1,
  };
}

/** Inimigos das ondas em andamento que ainda não nasceram ou ainda estão vivos (0 sem onda). */
export function waveRemaining(
  state: Readonly<RunState>,
  schedules: readonly WaveSchedule[],
): number {
  let remaining = 0;
  for (const wave of state.waves.active) {
    remaining += (schedules[wave.wave - 1]?.entries.length ?? 0) - wave.spawned;
  }
  // Inimigo com onda está numa onda ativa: a onda só fecha sem nenhum vivo.
  for (const enemy of state.enemies.slots) {
    if (enemy.active && enemy.wave !== 0) remaining++;
  }
  return remaining;
}

/** Vivos por onda: `alive[n]` = inimigos vivos da onda `n` (índice 0 = sem onda). */
function countAliveByWave(state: Readonly<RunState>, waveCount: number): number[] {
  const alive = new Array<number>(waveCount + 1).fill(0);
  for (const enemy of state.enemies.slots) {
    if (enemy.active && enemy.wave < alive.length) alive[enemy.wave]!++;
  }
  return alive;
}

function hasUnspawned(wave: ActiveWave, schedules: readonly WaveSchedule[]): boolean {
  return wave.spawned < (schedules[wave.wave - 1]?.entries.length ?? 0);
}

/**
 * Ação do jogador: chama a próxima onda. Com outra onda ativa é chamada
 * antecipada: o bônus fica guardado na onda e só é pago quando ela fechar.
 * O bônus só vale com a janela aberta (`earlyBonusWindow`); fora dela, a
 * chamada antecipada sai com bônus 0.
 */
export function callWave(
  ctx: TickContext,
  schedules: readonly WaveSchedule[],
  enemies: EnemyData,
  economy: EconomyData,
): void {
  const { state } = ctx;
  const reason = callWaveRefusal(state, schedules, enemies);
  if (reason !== null) {
    ctx.emit({ type: 'callWaveRefused', tick: state.tick, reason });
    return;
  }
  const wave = nextWaveNumber(state);
  const early = state.waves.active.length > 0;
  const window = earlyBonusWindow(state, schedules, economy);
  const earlyBonus = window?.open ? earlyBonusFor(economy, state.waves.active.length) : 0;
  state.waves.active.push({ wave, startTick: state.tick, spawned: 0, bossesKilled: 0, earlyBonus });
  ctx.emit({ type: 'waveStarted', tick: state.tick, wave, early, earlyBonus });
}

/**
 * Debug ("Encerrar onda"): com ondas em andamento, tira do mapa os inimigos
 * e projéteis (sem ouro de abate), esquece os nascimentos que faltam e fecha
 * todas pelo `endWave`, em ordem, pagando os bônus antecipados. Sem onda,
 * fecha a próxima. Depois da última onda, não faz nada (e nunca é vitória).
 */
export function forceEndWave(
  ctx: TickContext,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
): void {
  const { state } = ctx;
  const active = state.waves.active;
  if (active.length === 0) {
    if (state.wave < schedules.length) endWave(ctx, economy, towers);
    return;
  }
  releaseAllEnemies(state.enemies);
  releaseAllProjectiles(state.projectiles);
  state.waves.active = [];
  for (const wave of active) endWave(ctx, economy, towers, wave.earlyBonus);
}

/**
 * Debug ("Pular para onda"): sem ondas em andamento, fecha ondas pelo
 * `endWave` (com juros, bônus e loja nova de cada uma) até a próxima a
 * chamar ser `target`.
 */
export function skipToWave(
  ctx: TickContext,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
  target: number,
): void {
  const { state } = ctx;
  if (state.waves.active.length > 0 || !Number.isFinite(target)) return;
  const last = Math.min(Math.floor(target), schedules.length) - 1;
  while (state.wave < last) endWave(ctx, economy, towers);
}

/**
 * Nascimentos das ondas em andamento, logo depois das ações: todo inimigo
 * cujo tick já chegou nasce na entrada, com a vida multiplicada pelo
 * `hpMultiplier` da onda (o chefão fica com a vida dos dados) e, no elite,
 * pelo multiplicador do elite. Entre ondas
 * diferentes, nasce primeiro quem venceu antes; no empate, a onda mais antiga.
 *
 * Fila invisível: com `maxActiveEnemies` ativos, os próximos esperam na
 * entrada, nessa mesma ordem, e nascem quando abrir espaço.
 */
export function createWaveSpawnSystem(
  routes: Routes,
  enemies: EnemyData,
  schedules: readonly WaveSchedule[],
  maxActiveEnemies: number,
): System {
  return (ctx) => {
    const { state } = ctx;
    if (state.status !== 'playing') return;
    const active = state.waves.active;
    while (state.enemies.activeCount < maxActiveEnemies) {
      let next: ActiveWave | null = null;
      let nextTick = Infinity;
      for (const wave of active) {
        const entry = schedules[wave.wave - 1]?.entries[wave.spawned];
        if (!entry) continue;
        const due = wave.startTick + entry.tick;
        if (due <= state.tick && due < nextTick) {
          next = wave;
          nextTick = due;
        }
      }
      if (!next) break;
      const schedule = schedules[next.wave - 1]!;
      const { type, elite } = schedule.entries[next.spawned]!;
      const multiplier = getEnemyType(enemies, type).boss ? 1 : schedule.hpMultiplier;
      spawnEnemy(ctx, routes, enemies, type, 0, multiplier, next.wave, elite);
      next.spawned++;
    }
  };
}

/**
 * Depois do ouro: conta os abates do tick e fecha as ondas em ordem. A mais
 * antiga fecha quando todos os inimigos dela já nasceram e nenhum está vivo;
 * uma onda só fecha depois da anterior (várias podem fechar no mesmo tick).
 * No fim da última onda, com os chefões mortos, a run é vencida (depois do
 * `endWave`).
 */
export function createWaveProgressSystem(
  enemies: EnemyData,
  schedules: readonly WaveSchedule[],
  economy: EconomyData,
  towers: TowerData,
): System {
  return (ctx) => {
    const { state } = ctx;
    const active = state.waves.active;
    for (const event of ctx.tickEvents) {
      if (event.type !== 'enemyKilled') continue;
      state.stats.kills++;
      if (event.wave === 0 || !getEnemyType(enemies, event.enemyType).boss) continue;
      const owner = active.find((w) => w.wave === event.wave);
      if (owner) owner.bossesKilled++;
    }
    if (active.length === 0 || state.status !== 'playing') return;
    const alive = countAliveByWave(state, schedules.length);
    while (active.length > 0) {
      const wave = active[0]!;
      if (hasUnspawned(wave, schedules) || (alive[wave.wave] ?? 0) > 0) return;
      active.shift();
      endWave(ctx, economy, towers, wave.earlyBonus);
      const schedule = schedules[wave.wave - 1];
      const bossCount = schedule ? bossCountOf(schedule, enemies) : 0;
      if (state.wave === schedules.length && wave.bossesKilled >= bossCount) {
        state.status = 'won';
        ctx.emit({ type: 'runWon', tick: state.tick, wave: state.wave });
        return;
      }
    }
  };
}
