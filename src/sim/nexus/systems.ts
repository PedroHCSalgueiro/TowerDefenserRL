/**
 * Sistemas do núcleo: dano de quem chega, derrota e o ataque fraco.
 */

import engineConfig from '../../data/engine.json';
import { damageEnemy } from '../enemies/damage';
import { getEnemyType, type EnemyData } from '../enemies/enemyData';
import { releaseEnemy } from '../enemies/pool';
import type { Routes } from '../enemies/route';
import type { System } from '../engine/simulation';
import type { GridCoord } from '../grid/map';
import { SpatialIndex } from '../spatial/spatialIndex';
import type { NexusData } from './nexusData';

/**
 * Inimigo que chegou ao fim da rota causa `nexusDamage` e sai do mapa. Se a
 * vida do núcleo zerar, a run termina (`runLost` é emitido uma vez). O
 * chefão que chega é derrota imediata, qualquer que seja a vida: o núcleo
 * vai a 0. Com o núcleo invulnerável (debug), o inimigo (chefão inclusive)
 * sai do mapa sem causar dano.
 */
export function createNexusContactSystem(routes: Routes, data: EnemyData): System {
  return (ctx) => {
    const { state } = ctx;
    for (const enemy of state.enemies.slots) {
      if (!enemy.active) continue;
      const type = getEnemyType(data, enemy.type);
      if (enemy.distance < routes[type.movement].length) continue;
      const invulnerable = state.debug.nexusInvulnerable;
      const damage = invulnerable ? 0 : type.boss ? state.nexus.hp : type.nexusDamage;
      state.nexus.hp = Math.max(0, state.nexus.hp - damage);
      releaseEnemy(state.enemies, enemy);
      ctx.emit({ type: 'enemyReachedNexus', tick: state.tick, enemyId: enemy.id, damage });
      if (type.boss && !invulnerable) {
        ctx.emit({
          type: 'bossReachedNexus',
          tick: state.tick,
          enemyId: enemy.id,
          enemyType: enemy.type,
        });
      }
    }
    if (state.nexus.hp <= 0 && state.status === 'playing') {
      state.status = 'lost';
      ctx.emit({ type: 'runLost', tick: state.tick });
    }
  };
}

/**
 * Ataca o inimigo mais próximo do núcleo dentro do alcance (voadores
 * inclusive), com desempate pelo menor id. Um ataque a cada `cooldownSeconds`.
 * A busca usa o índice espacial (o mesmo das torres, quando compartilhado).
 */
export function createNexusAttackSystem(
  nexusCell: GridCoord,
  enemies: EnemyData,
  nexus: NexusData,
  ticksPerSecond: number,
  index: SpatialIndex = new SpatialIndex(engineConfig.spatialCellSize),
): System {
  const { damage, range } = nexus.attack;
  const cooldownTicks = Math.max(1, Math.round(nexus.attack.cooldownSeconds * ticksPerSecond));

  return (ctx) => {
    const { state } = ctx;
    if (state.status !== 'playing') return;
    if (state.nexus.attackCooldownTicks > 0) state.nexus.attackCooldownTicks--;
    if (state.nexus.attackCooldownTicks > 0) return;

    const target = index.findNearest(state, nexusCell.x, nexusCell.y, range);
    if (!target) return;

    state.nexus.attackCooldownTicks = cooldownTicks;
    ctx.emit({
      type: 'nexusFired',
      tick: state.tick,
      targetId: target.id,
      x: target.x,
      y: target.y,
    });
    damageEnemy(ctx, enemies, target, damage, null);
  };
}
