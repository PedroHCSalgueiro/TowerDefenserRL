/**
 * Projéteis teleguiados: disparar, mover até o alvo e causar o dano.
 *
 * O projétil persegue a posição atual do alvo. Ao alcançá-lo, aplica o dano
 * por `damageEnemy()` (armadura, morte e evento, com o id da torre) e volta
 * para o pool. No tiro em área, o dano vai para todos os inimigos no raio do
 * ponto de impacto, em ordem de id.
 *
 * Alvo que some antes do impacto (morreu ou chegou ao núcleo): o projétil
 * troca uma única vez para o inimigo mais próximo do ponto em que o alvo
 * sumiu, dentro de `retargetRadius` (empate para o menor id). Sem ninguém no
 * raio, ou se o alvo novo também sumir, o projétil some sem causar dano.
 *
 * O ponto em que o alvo sumiu é exato: enquanto o slot do alvo ainda tem o id
 * dele (nenhum inimigo nasce no meio do tick), a posição vem do slot; depois
 * que o slot é reaproveitado, vale a última posição guardada no projétil.
 */

import { damageEnemy } from '../enemies/damage';
import type { EnemyData } from '../enemies/enemyData';
import { sortEnemiesById } from '../enemies/order';
import type { Enemy } from '../enemies/pool';
import type { System, TickContext } from '../engine/simulation';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { RunState } from '../state';
import { acquireProjectile, releaseProjectile, type Projectile } from './pool';

export interface FireParams {
  sourceId: number;
  x: number;
  y: number;
  damage: number;
  speed: number;
  /** Raio do tiro em área, em casas; 0 = tiro único. */
  areaRadius: number;
}

/** Cria um projétil na posição de quem disparou, mirando `target`. */
export function fireProjectile(ctx: TickContext, params: FireParams, target: Enemy): void {
  const projectile = acquireProjectile(ctx.state.projectiles);
  projectile.id = ctx.allocateId();
  projectile.sourceId = params.sourceId;
  aim(projectile, target);
  projectile.retargeted = false;
  projectile.damage = params.damage;
  projectile.areaRadius = params.areaRadius;
  projectile.speed = params.speed;
  projectile.x = projectile.prevX = params.x;
  projectile.y = projectile.prevY = params.y;
}

function aim(projectile: Projectile, target: Enemy): void {
  projectile.targetId = target.id;
  projectile.targetSlot = target.slot;
  projectile.targetX = target.x;
  projectile.targetY = target.y;
}

/**
 * Atualiza a última posição conhecida do alvo e devolve o alvo se ele ainda
 * estiver no mapa, ou `null` se já sumiu.
 */
function trackTarget(state: RunState, projectile: Projectile): Enemy | null {
  const enemy = state.enemies.slots[projectile.targetSlot];
  if (!enemy || enemy.id !== projectile.targetId) return null;
  projectile.targetX = enemy.x;
  projectile.targetY = enemy.y;
  return enemy.active ? enemy : null;
}

export function createProjectileSystem(
  enemies: EnemyData,
  index: SpatialIndex,
  retargetRadius: number,
  ticksPerSecond: number,
): System {
  const hits: Enemy[] = [];

  /** Dano em área: todos no raio do ponto de impacto, em ordem de id. */
  const explode = (ctx: TickContext, projectile: Projectile, x: number, y: number): void => {
    const radius = projectile.areaRadius;
    ctx.emit({
      type: 'areaExploded',
      tick: ctx.state.tick,
      towerId: projectile.sourceId,
      x,
      y,
      radius,
    });
    hits.length = 0;
    index.collectInRange(ctx.state, x, y, radius, hits);
    for (const enemy of sortEnemiesById(hits)) {
      damageEnemy(ctx, enemies, enemy, projectile.damage, projectile.sourceId);
    }
  };

  return (ctx) => {
    const { state } = ctx;
    const pool = state.projectiles;
    for (const projectile of pool.slots) {
      if (!projectile.active) continue;

      let target = trackTarget(state, projectile);
      if (!target && !projectile.retargeted) {
        target = index.findNearest(state, projectile.targetX, projectile.targetY, retargetRadius);
        if (target) {
          projectile.retargeted = true;
          aim(projectile, target);
        }
      }
      if (!target) {
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
        if (projectile.areaRadius > 0) {
          explode(ctx, projectile, target.x, target.y);
        } else {
          damageEnemy(ctx, enemies, target, projectile.damage, projectile.sourceId);
        }
      } else {
        projectile.x += (dx / dist) * step;
        projectile.y += (dy / dist) * step;
      }
    }
  };
}
