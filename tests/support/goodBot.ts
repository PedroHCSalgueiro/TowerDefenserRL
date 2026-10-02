/**
 * Bot bom (T21): joga como alguém que conhece o jogo, para provar a curva de
 * dificuldade. Entre as ondas:
 * - abre com 2 torres diferentes; depois funde primeiro (compra a cópia que
 *   vira ★2 ou ★3), mesmo mexendo na reserva;
 * - guarda para os juros: a partir da onda 3 só gasta o que passar da reserva
 *   `min(100, 10 × (onda − 2))` (100 guardados = teto de juros);
 * - escolhe a torre pelo preço, pelas classes que já tem (bônus de classe) e
 *   pelas cópias que já tem (fusão futura);
 * - posiciona por vizinhança: a primeira na casa que mais vê o caminho, as
 *   outras coladas nas que já estão (4 vizinhas), e o Relé onde tem mais vizinhas;
 * - evolui o núcleo quando o limite enche;
 * - rerola com o que sobra acima da reserva, procurando cópias.
 * Chama a próxima onda só com o mapa limpo (não empilha).
 */

import { economyData } from '../../src/sim/economy/economyData';
import type { Simulation } from '../../src/sim/engine/simulation';
import type { GridCoord } from '../../src/sim/grid/map';
import { maxNexusLevel, nexusData, nexusLevel } from '../../src/sim/nexus/nexusData';
import { priceOf } from '../../src/sim/shop/shop';
import { planFusion } from '../../src/sim/towers/fusion';
import { hasRoomForTower } from '../../src/sim/towers/limit';
import { towerData } from '../../src/sim/towers/towerData';
import { botCells, botMap } from './waveBot';

/** Torres diferentes no mapa antes da primeira fusão. */
const OPENING_TOWERS = 2;
/** Teto de rerolls por pausa. */
const MAX_REROLLS = 4;
/** Ouro guardado na onda `wave` (a próxima a chamar). */
export function goodBotReserve(wave: number): number {
  return wave < 3 ? 0 : Math.min(100, 10 * (wave - 2));
}

const CELLS = botCells(botMap);
const COVERAGE = new Map(CELLS.map((c, i) => [botMap.indexOf(c), CELLS.length - i]));

function neighbors(cell: GridCoord): GridCoord[] {
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 },
  ];
}

/** Casa livre para `type`: colada nas torres que já estão, a que mais vê o caminho. */
function chooseCell(sim: Simulation, type: string): GridCoord | undefined {
  const used = new Set(sim.state.towers.map((t) => botMap.indexOf(t)));
  const free = CELLS.filter((c) => !used.has(botMap.indexOf(c)));
  if (used.size === 0) return free[0];
  const touching = (c: GridCoord) =>
    neighbors(c).filter((n) => botMap.isInside(n) && used.has(botMap.indexOf(n))).length;
  const relay = type === 'relay';
  let best: GridCoord | undefined;
  let bestScore = -Infinity;
  for (const cell of free) {
    const t = touching(cell);
    if (t === 0) continue;
    const score = (relay ? 100 * t : 10 * t) + (COVERAGE.get(botMap.indexOf(cell)) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best ?? free[0];
}

function classesOwned(sim: Simulation): Map<string, number> {
  const owned = new Map<string, number>();
  const types = new Set(sim.state.towers.map((t) => t.type));
  for (const type of types) {
    for (const c of towerData.types[type]?.classes ?? []) owned.set(c, (owned.get(c) ?? 0) + 1);
  }
  return owned;
}

function towerScore(sim: Simulation, type: string, price: number): number {
  const owned = classesOwned(sim);
  const data = towerData.types[type]!;
  const synergy = data.classes.reduce(
    (s, c) => s + (owned.get(c) === 1 ? 8 : owned.has(c) ? 3 : 0),
    0,
  );
  const isNew = sim.state.towers.some((t) => t.type === type) ? 0 : 4;
  return price + synergy + isNew;
}

function action(sim: Simulation, rerolls: { left: number }): boolean {
  const { state } = sim;
  const reserve = goodBotReserve(state.wave + 1);
  const spendable = state.gold - reserve;
  const slots = state.shop.slots
    .map((type, slot) => ({ type, slot }))
    .filter((s): s is { type: string; slot: number } => s.type !== null)
    .map((s) => ({ ...s, price: priceOf(economyData, towerData, s.type) ?? Infinity }));

  const fuses = (type: string) => planFusion(state.towers, towerData, type) !== null;
  const fusing = slots.find((s) => s.price <= state.gold && fuses(s.type));
  // Abertura: antes de fundir, tem pelo menos OPENING_TOWERS torres diferentes no mapa.
  const opening =
    state.towers.length < OPENING_TOWERS &&
    hasRoomForTower(state) &&
    slots.some((s) => s.price <= state.gold && !fuses(s.type));
  if (fusing && !opening) {
    sim.enqueue({ type: 'buyTower', slot: fusing.slot });
    return true;
  }
  if (hasRoomForTower(state)) {
    const affordable = slots.filter((s) => s.price <= spendable || state.towers.length === 0);
    const usable = affordable.filter((s) => s.price <= state.gold && !fuses(s.type));
    if (usable.length > 0) {
      const best = usable.reduce((a, b) =>
        towerScore(sim, b.type, b.price) > towerScore(sim, a.type, a.price) ? b : a,
      );
      const cell = chooseCell(sim, best.type);
      if (cell) {
        sim.enqueue({ type: 'buyTower', slot: best.slot, ...cell });
        return true;
      }
    }
  } else {
    const level = state.nexus.level;
    if (level < maxNexusLevel(nexusData) && nexusLevel(nexusData, level + 1).cost <= spendable) {
      sim.enqueue({ type: 'evolveNexus' });
      return true;
    }
  }
  if (rerolls.left > 0 && spendable >= economyData.shop.rerollCost + 10) {
    rerolls.left--;
    sim.enqueue({ type: 'rerollShop' });
    return true;
  }
  return false;
}

/** A pausa entre ondas do bot bom: age até não ter mais o que fazer (um tick por ação). */
export function goodBotBreak(sim: Simulation): void {
  const rerolls = { left: MAX_REROLLS };
  for (let guard = 0; guard < 100 && action(sim, rerolls); guard++) sim.step();
}
