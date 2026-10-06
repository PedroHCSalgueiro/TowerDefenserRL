/**
 * Bot simples para jogar uma run inteira no mapa real: entre as ondas compra
 * o que dá (fusão primeiro, depois a torre mais cara que couber), evolui o
 * núcleo quando o limite enche, rerola um pouco, e chama a próxima onda.
 * Na tela de recompensa (T24) pega sempre a primeira carta.
 * Não é para jogar bem: é para garantir que as 40 ondas terminam sem erro e
 * para medir as ondas com torres de verdade matando.
 */

import mapData from '../../src/data/map.json';
import { economyData } from '../../src/sim/economy/economyData';
import { Simulation } from '../../src/sim/engine/simulation';
import { loadMap, type GridCoord, type GridMap } from '../../src/sim/grid/map';
import { maxNexusLevel, nexusData, nexusLevel } from '../../src/sim/nexus/nexusData';
import { rewardData, type RewardData } from '../../src/sim/rewards/rewardData';
import { rewardScreenOpen } from '../../src/sim/rewards/rewardState';
import { shopPrice, shopRerollCost } from '../../src/sim/shop/shop';
import { createGameSystems, type GameSystemsOptions } from '../../src/sim/systems';
import { planFusion } from '../../src/sim/towers/fusion';
import { hasRoomForTower } from '../../src/sim/towers/limit';
import { towerData } from '../../src/sim/towers/towerData';
import { waveData } from '../../src/sim/waves/waveData';

export const botMap = loadMap(mapData);
export const TOTAL_WAVES = waveData.waves.length;

/** Rerolls por pausa entre ondas. */
const REROLLS_PER_BREAK = 2;
/** Ouro que o bot guarda além do reroll (para os juros e a próxima compra). */
const REROLL_RESERVE = 10;
/** Teto de ticks de uma onda (as últimas passam de 100 s; o chefão final leva 76 s só de caminho). */
const MAX_WAVE_TICKS = 30 * 60 * 8;

/** Casas de torre, das que veem mais casas do caminho (alcance 3) para as que veem menos. */
export function botCells(map: GridMap): GridCoord[] {
  const cells: { cell: GridCoord; score: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.canPlaceTower({ x, y })) continue;
      const score = map.pathCells.filter((p) => Math.hypot(p.x - x, p.y - y) <= 3).length;
      cells.push({ cell: { x, y }, score });
    }
  }
  return cells.sort((a, b) => b.score - a.score).map((c) => c.cell);
}

const CELLS = botCells(botMap);

/** Recompensas desligadas (nenhuma onda abre a tela): marcos e comparação "sem recompensas". */
export const noRewards: RewardData = { ...rewardData, waves: [] };

export function botSim(
  seed: string,
  nexusInvulnerable = false,
  options: GameSystemsOptions = {},
): Simulation {
  const sim = Simulation.create(seed, createGameSystems(botMap, options));
  if (nexusInvulnerable) sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
  return sim;
}

function freeCell(sim: Simulation): GridCoord | undefined {
  const used = new Set(sim.state.towers.map((t) => botMap.indexOf(t)));
  return CELLS.find((c) => !used.has(botMap.indexOf(c)));
}

/** Uma ação da pausa entre ondas, já enfileirada; `false` = nada mais a fazer. */
function botAction(sim: Simulation, rerolls: { left: number }): boolean {
  const { state } = sim;
  const slots = state.shop.slots
    .map((type, slot) => ({ type, slot }))
    .filter((s): s is { type: string; slot: number } => s.type !== null)
    .map((s) => ({ ...s, price: shopPrice(economyData, towerData, state, s.type) ?? Infinity }))
    .filter((s) => s.price <= state.gold);
  const fusing = slots.find((s) => planFusion(state.towers, towerData, s.type) !== null);
  if (fusing) {
    sim.enqueue({ type: 'buyTower', slot: fusing.slot });
    return true;
  }
  const cell = freeCell(sim);
  if (cell && hasRoomForTower(state) && slots.length > 0) {
    const best = slots.reduce((a, b) => (b.price > a.price ? b : a));
    sim.enqueue({ type: 'buyTower', slot: best.slot, ...cell });
    return true;
  }
  const level = state.nexus.level;
  if (
    !hasRoomForTower(state) &&
    level < maxNexusLevel(nexusData) &&
    state.gold >= nexusLevel(nexusData, level + 1).cost
  ) {
    sim.enqueue({ type: 'evolveNexus' });
    return true;
  }
  if (rerolls.left > 0 && state.gold >= shopRerollCost(economyData, state) + REROLL_RESERVE) {
    rerolls.left--;
    sim.enqueue({ type: 'rerollShop' });
    return true;
  }
  return false;
}

/** Tela de recompensa do bot simples: a primeira carta. */
export function firstReward(sim: Simulation): void {
  sim.enqueue({ type: 'chooseReward', index: 0 });
}

/**
 * Resolve as telas de recompensa abertas (e as da fila), uma ação por tick.
 * Se `onReward` não fizer nada, o tempo da tela acaba e a simulação escolhe.
 */
export function resolveRewards(sim: Simulation, onReward: (sim: Simulation) => void): void {
  for (let guard = 0; guard < 10_000 && rewardScreenOpen(sim.state); guard++) {
    if (sim.state.status !== 'playing') return;
    onReward(sim);
    sim.step();
  }
}

/** A pausa entre ondas: age até não ter mais o que fazer (um tick por ação). */
export function botBreak(sim: Simulation): void {
  const rerolls = { left: REROLLS_PER_BREAK };
  for (let guard = 0; guard < 100 && botAction(sim, rerolls); guard++) sim.step();
}

export interface WaveReport {
  wave: number;
  /** Ticks do "Chamar onda" até o fim da onda (ou até a derrota). */
  ticks: number;
  kills: number;
  /** Maior número de abates num único tick. */
  peakKillsPerTick: number;
  /** Gatilhos descartados pela fila durante a onda. */
  dropped: number;
  /** Maior profundidade de cadeia vista num tick. */
  maxDepth: number;
  /** Maior número de gatilhos executados num tick. */
  peakTriggersPerTick: number;
  towers: number;
  nexusHp: number;
  /** Maior número de inimigos vivos ao mesmo tempo durante a onda. */
  peakEnemies: number;
  /** Ouro ganho na run até o fim da onda (juros, renda e antecipado). */
  goldEarned: number;
  /** Ouro guardado no fim da onda (antes da pausa seguinte). */
  gold: number;
  /** Ouro da "Cadeia lucrativa" na run até o fim da onda (T24). */
  chainGold: number;
  /** Maior cadeia da run até o fim da onda. */
  longestChain: number;
  nexusLevel: number;
}

/**
 * Chama a próxima onda e roda até ela acabar (ou a run terminar). Devolve as
 * medidas da onda. Tela de recompensa aberta no meio da onda: `onReward`.
 */
export function playWave(
  sim: Simulation,
  onReward: (sim: Simulation) => void = firstReward,
): WaveReport {
  resolveRewards(sim, onReward);
  const wave = sim.state.wave + 1;
  const start = sim.state.tick;
  const droppedBefore = sim.state.triggers.droppedTotal;
  const killsBefore = sim.state.stats.kills;
  sim.enqueue({ type: 'callWave' });
  sim.step();
  let peak = 0;
  let maxDepth = 0;
  let peakTriggers = 0;
  let peakEnemies = 0;
  const observe = () => {
    peakEnemies = Math.max(peakEnemies, sim.state.enemies.activeCount);
    let kills = 0;
    for (const event of sim.drainEvents()) if (event.type === 'enemyKilled') kills++;
    peak = Math.max(peak, kills);
    const last = sim.state.triggers.lastTick;
    maxDepth = Math.max(maxDepth, last.maxDepth);
    peakTriggers = Math.max(peakTriggers, last.fired);
  };
  observe();
  for (let i = 0; i < MAX_WAVE_TICKS && sim.state.waves.active.length > 0; i++) {
    if (sim.state.status !== 'playing') break;
    if (rewardScreenOpen(sim.state)) onReward(sim);
    sim.step();
    observe();
  }
  return {
    wave,
    ticks: sim.state.tick - start,
    kills: sim.state.stats.kills - killsBefore,
    peakKillsPerTick: peak,
    dropped: sim.state.triggers.droppedTotal - droppedBefore,
    maxDepth,
    peakTriggersPerTick: peakTriggers,
    towers: sim.state.towers.length,
    nexusHp: sim.state.nexus.hp,
    peakEnemies,
    goldEarned: sim.state.stats.goldEarned,
    gold: sim.state.gold,
    chainGold: sim.state.stats.chainGold,
    longestChain: sim.state.stats.longestChain,
    nexusLevel: sim.state.nexus.level,
  };
}

/**
 * Run inteira: telas de recompensa, pausa do bot, onda, até a vitória, a
 * derrota ou a última onda.
 */
export function playRun(
  sim: Simulation,
  onBreak: (sim: Simulation) => void = botBreak,
  onReward: (sim: Simulation) => void = firstReward,
) {
  const reports: WaveReport[] = [];
  while (sim.state.status === 'playing' && sim.state.wave < TOTAL_WAVES) {
    resolveRewards(sim, onReward);
    onBreak(sim);
    sim.drainEvents();
    reports.push(playWave(sim, onReward));
  }
  return reports;
}
