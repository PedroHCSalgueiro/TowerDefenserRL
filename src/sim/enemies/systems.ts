/**
 * Inimigos: spawn (chamado pelas ações e pelo modo estresse) e movimento.
 */

import type { System, TickContext } from '../engine/simulation';
import { getEnemyType, type EnemyData } from './enemyData';
import { acquireEnemy, type Enemy } from './pool';
import type { Routes } from './route';

/**
 * Coloca um inimigo do tipo pedido a `distance` casas do início da sua rota
 * (0 = na entrada) e emite `enemySpawned`. `hpMultiplier` multiplica a vida
 * dos dados (o multiplicador da onda); `wave` é a onda dona do inimigo (0 = sem onda).
 */
export function spawnEnemy(
  ctx: TickContext,
  routes: Routes,
  data: EnemyData,
  enemyType: string,
  distance = 0,
  hpMultiplier = 1,
  wave = 0,
): Enemy {
  const type = getEnemyType(data, enemyType);
  const enemy = acquireEnemy(ctx.state.enemies);
  enemy.id = ctx.allocateId();
  enemy.type = enemyType;
  enemy.wave = wave;
  enemy.hp = type.hp * hpMultiplier;
  enemy.maxHp = enemy.hp;
  enemy.distance = distance;
  routes[type.movement].sampleInto(distance, enemy);
  // Sem isso, um slot reaproveitado seria interpolado a partir da posição antiga.
  enemy.prevX = enemy.x;
  enemy.prevY = enemy.y;
  ctx.emit({
    type: 'enemySpawned',
    tick: ctx.state.tick,
    enemyId: enemy.id,
    enemyType: enemy.type,
  });
  return enemy;
}

/**
 * Anda `speed / ticksPerSecond` casas por tick, guardando a posição anterior
 * para a renderização interpolar.
 */
export function createMovementSystem(
  routes: Routes,
  data: EnemyData,
  ticksPerSecond: number,
): System {
  return (ctx) => {
    for (const enemy of ctx.state.enemies.slots) {
      if (!enemy.active) continue;
      const type = getEnemyType(data, enemy.type);
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      enemy.distance += type.speed / ticksPerSecond;
      routes[type.movement].sampleInto(enemy.distance, enemy);
    }
  };
}
