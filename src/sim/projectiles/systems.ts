/**
 * Projéteis teleguiados: disparar e mover até o alvo.
 *
 * O projétil persegue a posição atual do alvo. Ao alcançá-lo, aplica o dano
 * por `damageEnemy()` (armadura, morte e evento) e volta para o pool. Se o
 * alvo morrer ou sair do mapa antes, o projétil some sem causar dano
 * (regra provisória da T05; a T06 decide a definitiva).
 */

import { damageEnemy } from '../enemies/damage';
import type { EnemyData } from '../enemies/enemyData';
import type { Enemy } from '../enemies/pool';
import type { System, TickContext } from '../engine/simulation';
import { acquireProjectile, releaseProjectile } from './pool';

export interface FireParams {
  sourceId: number;
  x: number;
  y: number;
  damage: number;
  speed: number;
}

/** Cria um projétil na posição de quem disparou, mirando `target`. */
export function fireProjectile(ctx: TickContext, params: FireParams, target: Enemy): void {
  const projectile = acquireProjectile(ctx.state.projectiles);
  projectile.id = ctx.allocateId();
  projectile.sourceId = params.sourceId;
  projectile.targetId = target.id;
  projectile.targetSlot = target.slot;
  projectile.damage = params.damage;
  projectile.speed = params.speed;
  projectile.x = projectile.prevX = params.x;
  projectile.y = projectile.prevY = params.y;
}

export function createProjectileSystem(enemies: EnemyData, ticksPerSecond: number): System {
  return (ctx) => {
    const { state } = ctx;
    const pool = state.projectiles;
    for (const projectile of pool.slots) {
      if (!projectile.active) continue;
      const target = state.enemies.slots[projectile.targetSlot];
      if (!target || !target.active || target.id !== projectile.targetId) {
        releaseProjectile(pool, projectile);
        continue;
      }
      projectile.prevX = projectile.x;
      projectile.prevY = projectile.y;
      const dx = target.x - projectile.x;
      const dy = target.y - projectile.y;
      const dist = Math.hypot(dx, dy);
      const step = projectile.speed / ticksPerSecond;
      if (dist <= step) {
        projectile.x = target.x;
        projectile.y = target.y;
        releaseProjectile(pool, projectile);
        damageEnemy(ctx, enemies, target, projectile.damage, projectile.sourceId);
      } else {
        projectile.x += (dx / dist) * step;
        projectile.y += (dy / dist) * step;
      }
    }
  };
}
