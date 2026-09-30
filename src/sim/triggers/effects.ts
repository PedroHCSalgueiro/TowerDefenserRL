/**
 * Os "o quê" dos gatilhos. Cada efeito age a partir da torre que o executa
 * (posição, alcance, alvo normal e dano base dela); os números vêm do efeito.
 *
 * - Disparo múltiplo e tiro de ativação usam projéteis normais.
 * - Explosão, raio em cadeia, tiro perfurante e execução são instantâneos.
 * - Todo dano passa por `damageEnemy()`, com o id da torre, e os alvos são
 *   atingidos em ordem de id (o raio segue a ordem dos saltos).
 * - Bônus de classe (`RunState.classes`): a Artilharia aumenta raio e dano da
 *   explosão; a Arcana tira o teto de vizinhas ativadas do Relé.
 * - O dano base é o da estrela da torre (`towerDamage`).
 */

import { areaDamageMultiplier, areaRadiusMultiplier, neighborhoodRadius } from '../classes/bonuses';
import type { ClassData } from '../classes/classData';
import { damageEnemy } from '../enemies/damage';
import { getEnemyType, type EnemyData } from '../enemies/enemyData';
import { sortEnemiesById } from '../enemies/order';
import type { Enemy } from '../enemies/pool';
import type { TickContext } from '../engine/simulation';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { Tower } from '../towers/placement';
import { fireTowerShot, findTowerTarget } from '../towers/systems';
import type { TargetScores } from '../towers/targeting';
import { towerDamage } from '../towers/stars';
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
  readonly classes: ClassData;
  readonly scores: TargetScores;
  /** Trava de ativação, em ticks (`activationCooldownSeconds`). */
  readonly activationCooldownTicks: number;
  /** Comprimento das linhas "sem limite", em casas. */
  readonly unlimitedLineLength: number;
  /** Vizinhas da torre (pela vizinhança dos dados e pelo bônus da Arcana), em ordem de id. */
  neighborsOf(tower: Tower): readonly Tower[];
  /** As vizinhas mais as casas em cruz até `reach` de distância, em ordem de id. */
  reachNeighborsOf(tower: Tower, reach: number): readonly Tower[];
  /** Põe na fila a explosão de uma execução (uma entrada própria por explosão). */
  enqueueBlast(
    tower: Tower,
    x: number,
    y: number,
    radius: number,
    percent: number,
    entry: PendingTrigger,
  ): void;
}

/** % do dano da torre (na estrela dela). */
const percentOf = (tower: Tower, type: TowerType, percent: number): number =>
  (towerDamage(type, tower) * percent) / 100;

/** Reaproveitado entre chamadas (a simulação roda numa thread só). */
const hits: Enemy[] = [];
const struck: number[] = [];

function collectSorted(env: EffectEnv, x: number, y: number, radius: number): Enemy[] {
  hits.length = 0;
  env.index.collectInRange(env.ctx.state, x, y, radius, hits);
  return sortEnemiesById(hits);
}

/** Alvos do `spread`, reaproveitado entre chamadas. */
const spreadTargets: Enemy[] = [];

/**
 * Tiros extras, sem gastar a recarga e sem contar como tiro. Todos no alvo
 * normal; com `spread`, cada um num alvo diferente pela ordem de mira (o
 * melhor primeiro), dando a volta se houver menos alvos que tiros.
 */
function multiShot(env: EffectEnv, tower: Tower, type: TowerType, e: Effect<'multiShot'>): void {
  const { state } = env.ctx;
  if (!e.spread) {
    const target = findTowerTarget(env.index, state, tower, type, env.scores);
    if (!target) return;
    for (let i = 0; i < e.extraShots; i++) {
      fireTowerShot(env.ctx, tower, type, target, 'extra', env.classes);
    }
    return;
  }
  const targets = env.index.findBestN(
    state,
    tower.x,
    tower.y,
    type.range,
    env.scores[type.targetMode],
    e.extraShots,
    spreadTargets,
  );
  if (targets.length === 0) return;
  for (let i = 0; i < e.extraShots; i++) {
    fireTowerShot(env.ctx, tower, type, targets[i % targets.length]!, 'extra', env.classes);
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
  const radius = e.radius * areaRadiusMultiplier(env.classes, ctx.state, type);
  ctx.emit({
    type: 'areaExploded',
    tick: ctx.state.tick,
    towerId: tower.id,
    x,
    y,
    radius,
  });
  const damage =
    percentOf(tower, type, e.damagePercent) * areaDamageMultiplier(env.classes, ctx.state, type);
  const options = e.killWeight !== 1 ? { killWeight: e.killWeight } : undefined;
  for (const enemy of collectSorted(env, x, y, radius)) {
    damageEnemy(ctx, env.enemies, enemy, damage, tower.id, options);
  }
}

/**
 * Ativa uma torre: gasta a trava dela, emite `towerActivated` e, se ela ataca
 * e tem alvo, dispara na hora um tiro ativado (sem gastar a recarga) com
 * `damagePercent` do dano dela. Sem alvo, a ativação vale mesmo assim.
 */
function activate(
  env: EffectEnv,
  source: Tower,
  target: Tower,
  depth: number,
  damagePercent: number,
): void {
  const { ctx } = env;
  const { state } = ctx;
  target.activationReadyTick = state.tick + env.activationCooldownTicks;
  ctx.emit({
    type: 'towerActivated',
    tick: state.tick,
    towerId: target.id,
    sourceTowerId: source.id,
    depth,
  });
  const targetType = getTowerType(env.towers, target.type);
  if (!targetType.attacks) return;
  const enemy = findTowerTarget(env.index, state, target, targetType, env.scores);
  if (enemy) fireTowerShot(ctx, target, targetType, enemy, 'activated', env.classes, damagePercent);
}

/**
 * Ativa as vizinhas em ordem de id, pulando as que ainda estão na trava de
 * ativação. Sem `maxTargets`, ativa todas as da vizinhança atual (a dos
 * dados, ampliada pela Arcana) e, com `reach`, as da cruz de alcance N;
 * com `maxTargets`, só as primeiras N (a Arcana tira esse teto). `selfToo`:
 * depois delas, a torre também se ativa, se a própria trava permitir.
 */
function activateNeighbors(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'activateNeighbors'>,
  depth: number,
): void {
  const { state } = env.ctx;
  const capped = e.maxTargets > 0 && neighborhoodRadius(env.classes, state, type) === 0;
  const list = e.reach > 0 ? env.reachNeighborsOf(tower, e.reach) : env.neighborsOf(tower);
  let activated = 0;
  for (const neighbor of list) {
    if (capped && activated >= e.maxTargets) break;
    if (state.tick < neighbor.activationReadyTick) continue;
    activated++;
    activate(env, tower, neighbor, depth, e.activatedDamagePercent);
  }
  if (e.selfToo && state.tick >= tower.activationReadyTick) {
    activate(env, tower, tower, depth, e.activatedDamagePercent);
  }
}

/** Ativação que o Obelisco ★3 faz ao soltar o raio: todas as vizinhas, 100%. */
const DISCHARGE_ACTIVATION: Effect<'activateNeighbors'> = {
  kind: 'activateNeighbors',
  maxTargets: 0,
  activatedDamagePercent: 100,
  reach: 0,
  selfToo: false,
};

/**
 * Raio em cadeia: começa em `first` e salta até completar `targets` inimigos
 * no total; cada salto vai ao inimigo mais próximo do anterior (empate: menor
 * id), dentro de `jumpRadius`, sem repetir. Com `activateOnDischarge`, ao
 * fim ativa as vizinhas.
 */
function releaseLightning(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'chargeLightning'>,
  first: Enemy,
  depth: number,
): void {
  const { ctx } = env;
  const damage = percentOf(tower, type, e.damagePercent);
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
  if (e.activateOnDischarge) activateNeighbors(env, tower, type, DISCHARGE_ACTIVATION, depth);
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
  releaseLightning(env, tower, type, e, target, entry.depth);
  return true;
}

/**
 * Linha reta da torre na direção do alvo normal, até o alcance (ou pelo mapa
 * inteiro, se `unlimited`): atinge todos nela.
 */
function pierceLine(env: EffectEnv, tower: Tower, type: TowerType, e: Effect<'pierceLine'>): void {
  const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
  if (!target) return;
  const dx = target.x - tower.x;
  const dy = target.y - tower.y;
  const length = Math.hypot(dx, dy);
  // Alvo exatamente sobre a torre: a direção não importa, mas precisa ser fixa.
  const ux = length > 0 ? dx / length : 1;
  const uy = length > 0 ? dy / length : 0;
  const reach = e.unlimited ? env.unlimitedLineLength : type.range;
  const damage = percentOf(tower, type, e.damagePercent);
  const inLine = collectSorted(env, tower.x, tower.y, reach + e.halfWidth).filter((enemy) => {
    const px = enemy.x - tower.x;
    const py = enemy.y - tower.y;
    const along = px * ux + py * uy;
    return along >= 0 && along <= reach && Math.abs(px * uy - py * ux) <= e.halfWidth;
  });
  for (const enemy of inLine) {
    damageEnemy(env.ctx, env.enemies, enemy, damage, tower.id);
  }
}

/**
 * Execução: mata na hora quem está no alcance com vida abaixo de `hpPercent`%
 * da máxima, sem armadura, valendo `killWeight` nos contadores. O chefão nunca
 * é executado: abaixo do limite, leva um golpe de `bossMaxHpPercent`% da vida
 * máxima (dano normal, com armadura; se matar, é abate de peso 1). Com
 * `explodeRadius`, cada execução põe uma explosão na fila, no ponto da morte.
 */
function execute(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  e: Effect<'execute'>,
  entry: PendingTrigger,
): void {
  const doomed = collectSorted(env, tower.x, tower.y, type.range).filter(
    (enemy) => enemy.hp < (enemy.maxHp * e.hpPercent) / 100,
  );
  for (const enemy of doomed) {
    if (getEnemyType(env.enemies, enemy.type).boss) {
      if (e.bossMaxHpPercent > 0) {
        damageEnemy(
          env.ctx,
          env.enemies,
          enemy,
          (enemy.maxHp * e.bossMaxHpPercent) / 100,
          tower.id,
        );
      }
      continue;
    }
    const { x, y } = enemy;
    damageEnemy(env.ctx, env.enemies, enemy, enemy.hp, tower.id, {
      ignoreArmor: true,
      killWeight: e.killWeight,
    });
    if (e.explodeRadius > 0) {
      env.enqueueBlast(tower, x, y, e.explodeRadius, e.explodeDamagePercent, entry);
    }
  }
}

/** A explosão de uma execução (entrada da fila): no ponto da morte, `percent` do dano da torre. */
export function runBlast(
  env: EffectEnv,
  tower: Tower,
  type: TowerType,
  entry: PendingTrigger,
): void {
  explosion(
    env,
    tower,
    type,
    {
      kind: 'explosion',
      radius: entry.blastRadius,
      damagePercent: entry.blastPercent,
      killWeight: 1,
    },
    entry,
  );
}

/** Candidatos do "copiar", reaproveitado entre chamadas. */
const candidates: Tower[] = [];

/** O efeito com o dano escalado por `power` % (só o dano; contagens e alvos ficam). */
function scaleEffect(effect: CopyableEffect, power: number): CopyableEffect {
  if (power === 100) return effect;
  switch (effect.kind) {
    case 'explosion':
    case 'chargeLightning':
    case 'pierceLine':
      return { ...effect, damagePercent: (effect.damagePercent * power) / 100 };
    case 'activateNeighbors':
      return { ...effect, activatedDamagePercent: (effect.activatedDamagePercent * power) / 100 };
    default:
      return effect;
  }
}

/**
 * Os "o quê" que "copiar" vai repetir: o último efeito disparado por cada
 * vizinha, os `copies` mais recentes (maior `seq`), de vizinhas diferentes,
 * com o dano escalado por `powerPercent`. Vazio se nenhuma vizinha disparou.
 */
export function resolveCopies(
  env: EffectEnv,
  tower: Tower,
  e: Effect<'copyLast'>,
): CopyableEffect[] {
  candidates.length = 0;
  for (const neighbor of env.neighborsOf(tower)) {
    if (neighbor.lastEffect) candidates.push(neighbor);
  }
  candidates.sort((a, b) => b.lastEffect!.seq - a.lastEffect!.seq);
  return candidates
    .slice(0, e.copies)
    .map((neighbor) => scaleEffect(neighbor.lastEffect!.effect, e.powerPercent));
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
      activateNeighbors(env, tower, type, effect, entry.depth);
      return true;
    case 'chargeLightning': {
      if (!copied) return chargeLightning(env, tower, type, effect, entry);
      const target = findTowerTarget(env.index, env.ctx.state, tower, type, env.scores);
      if (target) releaseLightning(env, tower, type, effect, target, entry.depth);
      return true;
    }
    case 'pierceLine':
      pierceLine(env, tower, type, effect);
      return true;
    case 'execute':
      execute(env, tower, type, effect, entry);
      return true;
  }
}
