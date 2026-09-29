/**
 * Os "o quê" dos gatilhos. Cada efeito age a partir da torre que o executa
 * (posição, alcance, alvo normal e dano base dela); os números vêm do efeito.
 *
 * - Disparo múltiplo e tiro de ativação usam projéteis normais.
 * - Explosão, raio em cadeia, tiro perfurante e execução são instantâneos.
 * - Todo dano passa por `damageEnemy()`, com o id da torre, e os alvos são
 *   atingidos em ordem de id (o raio segue a ordem dos saltos).
 */

import { damageEnemy } from '../enemies/damage';
import type { EnemyData } from '../enemies/enemyData';
import { sortEnemiesById } from '../enemies/order';
import type { Enemy } from '../enemies/pool';
import type { TickContext } from '../engine/simulation';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { Tower } from '../towers/placement';
import { fireTowerShot, findTowerTarget } from '../towers/systems';
import type { TargetScores } from '../towers/targeting';
import { getTowerType, type TowerData, type TowerType } from '../towers/towerData';
import type { CopyableEffect, TriggerEffect } from './triggerData';
import type { PendingTrigger } from './triggerState';

type Effect<K extends TriggerEffect['kind']> = Extract<TriggerEffect, { kind: K }>;

/** O que os efeitos precisam do mundo, montado pelo motor a cada tick. */
export interface EffectEnv {
  readonly ctx: TickContext;
  readonly index: SpatialIndex;
  readonly enemies: EnemyData;
  readonly towers: TowerData;
  readonly scores: TargetScores;
  /** Trava de ativação, em ticks (`activationCooldownSeconds`). */
  readonly activationCooldownTicks: number;
  /** Vizinhas da torre (pela vizinhança dos dados), em ordem de id. */
  neighborsOf(tower: Tower): readonly Tower[];
}

const percentOf = (type: TowerType, percent: number): number => (type.damage * percent) / 100;

/** Reaproveitado entre chamadas (a simulação roda numa thread só). */
const hits: Enemy[] = [];
const struck: number[] = [];

function collectSorted(env: EffectEnv, x: number, y: number, radius: number): Enemy[] {
  hits.length = 0;
  env.index.collectInRange(env.ctx.state, x, y, radius, hits);
  return sortEnemiesById(hits);
}

/** Tiros extras no alvo normal, sem gastar a recarga. Não contam como tiro. */
function multiShot(env: EffectEnv, tower: Tower, type: TowerType, e: Effect<'multiShot'>): void {
  const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
  if (!target) return;
  for (let i = 0; i < e.extraShots; i++) {
    fireTowerShot(env.ctx, tower, type, target, 'extra');
  }
}

/** Dano em área no ponto da morte que acionou o gatilho, ou no alvo normal. */
function explosion(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'explosion'>,
  entry: PendingTrigger,
): void {
  let x = entry.x;
  let y = entry.y;
  if (!entry.hasPoint) {
    const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
    if (!target) return;
    x = target.x;
    y = target.y;
  }
  const { ctx } = env;
  ctx.emit({
    type: 'areaExploded',
    tick: ctx.state.tick,
    towerId: tower.id,
    x,
    y,
    radius: e.radius,
  });
  const damage = percentOf(type, e.damagePercent);
  for (const enemy of collectSorted(env, x, y, e.radius)) {
    damageEnemy(ctx, env.enemies, enemy, damage, tower.id);
  }
}

/**
 * Ativa até `maxTargets` vizinhas, em ordem de id, pulando as que ainda estão
 * na trava de ativação. A ativada dispara na hora um tiro extra no alvo
 * normal dela (sem gastar a recarga); sem alvo, a ativação vale mesmo assim.
 */
function activateNeighbors(
  env: EffectEnv,
  tower: Tower,
  e: Effect<'activateNeighbors'>,
  depth: number,
): void {
  const { ctx } = env;
  const { state } = ctx;
  let activated = 0;
  for (const neighbor of env.neighborsOf(tower)) {
    if (activated >= e.maxTargets) break;
    if (state.tick < neighbor.activationReadyTick) continue;
    neighbor.activationReadyTick = state.tick + env.activationCooldownTicks;
    activated++;
    ctx.emit({
      type: 'towerActivated',
      tick: state.tick,
      towerId: neighbor.id,
      sourceTowerId: tower.id,
      depth,
    });
    const type = getTowerType(env.towers, neighbor.type);
    const target = findTowerTarget(env.index, state, neighbor, type, env.scores);
    if (target) fireTowerShot(ctx, neighbor, type, target, 'activated');
  }
}

/**
 * Raio em cadeia: começa em `first` e salta até completar `targets` inimigos
 * no total; cada salto vai ao inimigo mais próximo do anterior (empate: menor
 * id), dentro de `jumpRadius`, sem repetir.
 */
function releaseLightning(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'chargeLightning'>,
  first: Enemy,
): void {
  const { ctx } = env;
  const damage = percentOf(type, e.damagePercent);
  const skip = (enemy: Enemy): boolean => struck.includes(enemy.id);
  struck.length = 0;
  let current: Enemy | null = first;
  while (current && struck.length < e.targets) {
    struck.push(current.id);
    const { x, y } = current;
    damageEnemy(ctx, env.enemies, current, damage, tower.id);
    if (struck.length < e.targets) {
      current = env.index.findNearest(ctx.state, x, y, e.jumpRadius, skip);
    }
  }
}

/**
 * Ganha `entry.weight` cargas; com `charges` ou mais, solta o raio no alvo
 * normal e gasta `charges` (o excedente de um abate duplo fica). Sem alvo,
 * as cargas esperam presas em `charges`: não acumulam acima do valor da
 * descarga. Devolve se o raio saiu.
 */
function chargeLightning(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'chargeLightning'>,
  entry: PendingTrigger,
): boolean {
  tower.charges += entry.weight;
  if (tower.charges < e.charges) return false;
  const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
  if (!target) {
    tower.charges = e.charges;
    return false;
  }
  tower.charges -= e.charges;
  releaseLightning(env, tower, type, e, target);
  return true;
}

/** Linha reta da torre na direção do alvo normal, até o alcance: atinge todos nela. */
function pierceLine(env: EffectEnv, tower: Tower, type: TowerType, e: Effect<'pierceLine'>): void {
  const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
  if (!target) return;
  const dx = target.x - tower.x;
  const dy = target.y - tower.y;
  const length = Math.hypot(dx, dy);
  // Alvo exatamente sobre a torre: a direção não importa, mas precisa ser fixa.
  const ux = length > 0 ? dx / length : 1;
  const uy = length > 0 ? dy / length : 0;
  const damage = percentOf(type, e.damagePercent);
  const inLine = collectSorted(env, tower.x, tower.y, type.range + e.halfWidth).filter((enemy) => {
    const px = enemy.x - tower.x;
    const py = enemy.y - tower.y;
    const along = px * ux + py * uy;
    return along >= 0 && along <= type.range && Math.abs(px * uy - py * ux) <= e.halfWidth;
  });
  for (const enemy of inLine) {
    damageEnemy(env.ctx, env.enemies, enemy, damage, tower.id);
  }
}

/** Mata na hora quem está no alcance com vida abaixo de `hpPercent`% da máxima. */
function execute(env: EffectEnv, tower: Tower, type: TowerType, e: Effect<'execute'>): void {
  const doomed = collectSorted(env, tower.x, tower.y, type.range).filter(
    (enemy) => enemy.hp < (enemy.maxHp * e.hpPercent) / 100,
  );
  for (const enemy of doomed) {
    damageEnemy(env.ctx, env.enemies, enemy, enemy.hp, tower.id, {
      ignoreArmor: true,
      killWeight: e.killWeight,
    });
  }
}

/**
 * O "o quê" que "copiar" vai repetir: o último efeito disparado por uma
 * vizinha (maior `seq`). `null` se nenhuma disparou ainda.
 */
export function resolveCopy(env: EffectEnv, tower: Tower): CopyableEffect | null {
  let best: Tower | null = null;
  for (const neighbor of env.neighborsOf(tower)) {
    if (!neighbor.lastEffect) continue;
    if (!best || neighbor.lastEffect.seq > best.lastEffect!.seq) best = neighbor;
  }
  return best?.lastEffect?.effect ?? null;
}

/**
 * Executa um efeito pela torre. No "copiar", `effect` já vem resolvido e o
 * raio sai na hora (as cargas são da torre copiada). Devolve se o efeito
 * conta como disparado para "copiar": ganhar carga sem soltar o raio não conta.
 */
export function runEffect(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  effect: CopyableEffect,
  entry: PendingTrigger,
  copied: boolean,
): boolean {
  switch (effect.kind) {
    case 'multiShot':
      multiShot(env, tower, type, effect);
      return true;
    case 'explosion':
      explosion(env, tower, type, effect, entry);
      return true;
    case 'activateNeighbors':
      activateNeighbors(env, tower, effect, entry.depth);
      return true;
    case 'chargeLightning': {
      if (!copied) return chargeLightning(env, tower, type, effect, entry);
      const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
      if (target) releaseLightning(env, tower, type, effect, target);
      return true;
    }
    case 'pierceLine':
      pierceLine(env, tower, type, effect);
      return true;
    case 'execute':
      execute(env, tower, type, effect);
      return true;
  }
}
