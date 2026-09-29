/**
 * Sistemas dos inimigos: spawn (a partir da fila de ações) e movimento.
 */

import type { System } from '../engine/simulation';
import { getEnemyType, type EnemyData } from './enemyData';
import { acquireEnemy } from './pool';
import type { Routes } from './route';

/** Aplica os `spawnEnemy` do tick: o inimigo nasce no início da sua rota. */
export function createSpawnSystem(routes: Routes, data: EnemyData): System {
  return (ctx) => {
    for (const command of ctx.commands) {
      if (command.type !== 'spawnEnemy') continue;
      const type = getEnemyType(data, command.enemyType);
      const enemy = acquireEnemy(ctx.state.enemies);
      enemy.id = ctx.allocateId();
      enemy.type = command.enemyType;
      enemy.hp = type.hp;
      enemy.maxHp = type.hp;
      enemy.distance = 0;
      routes[type.movement].sampleInto(0, enemy);
      // Sem isso, um slot reaproveitado seria interpolado a partir da posição antiga.
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      ctx.emit({
        type: 'enemySpawned',
        tick: ctx.state.tick,
        enemyId: enemy.id,
        enemyType: enemy.type,
      });
    }
  };
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
