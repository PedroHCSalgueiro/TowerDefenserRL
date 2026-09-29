/**
 * Sistemas do núcleo: dano de quem chega, derrota e o ataque fraco.
 */

import { damageEnemy } from '../enemies/damage';
import { getEnemyType, type EnemyData } from '../enemies/enemyData';
import { releaseEnemy, type Enemy } from '../enemies/pool';
import type { Routes } from '../enemies/route';
import type { System } from '../engine/simulation';
import type { GridCoord } from '../grid/map';
import type { NexusData } from './nexusData';

/**
 * Inimigo que chegou ao fim da rota causa `nexusDamage` e sai do mapa. Se a
 * vida do núcleo zerar, a run termina (`runLost` é emitido uma vez).
 */
export function createNexusContactSystem(routes: Routes, data: EnemyData): System {
  return (ctx) => {
    const { state } = ctx;
    for (const enemy of state.enemies.slots) {
      if (!enemy.active) continue;
      const type = getEnemyType(data, enemy.type);
      if (enemy.distance < routes[type.movement].length) continue;
      state.nexus.hp = Math.max(0, state.nexus.hp - type.nexusDamage);
      releaseEnemy(state.enemies, enemy);
      ctx.emit({
        type: 'enemyReachedNexus',
        tick: state.tick,
        enemyId: enemy.id,
        damage: type.nexusDamage,
      });
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
 */
export function createNexusAttackSystem(
  nexusCell: GridCoord,
  enemies: EnemyData,
  nexus: NexusData,
  ticksPerSecond: number,
): System {
  const { damage, range } = nexus.attack;
  const cooldownTicks = Math.max(1, Math.round(nexus.attack.cooldownSeconds * ticksPerSecond));
  const rangeSq = range * range;

  return (ctx) => {
    const { state } = ctx;
    if (state.status !== 'playing') return;
    if (state.nexus.attackCooldownTicks > 0) state.nexus.attackCooldownTicks--;
    if (state.nexus.attackCooldownTicks > 0) return;

    let target: Enemy | null = null;
    let bestSq = Infinity;
    for (const enemy of state.enemies.slots) {
      if (!enemy.active) continue;
      const dx = enemy.x - nexusCell.x;
      const dy = enemy.y - nexusCell.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq) continue;
      if (distSq < bestSq || (distSq === bestSq && target !== null && enemy.id < target.id)) {
        target = enemy;
        bestSq = distSq;
      }
    }
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
