/**
 * Aplicar dano a um inimigo: armadura, morte e evento. Toda fonte de dano
 * (núcleo agora, torres depois) passa por aqui.
 */

import type { TickContext } from '../engine/simulation';
import { applyArmor } from './armor';
import { getEnemyType, type EnemyData } from './enemyData';
import { releaseEnemy, type Enemy } from './pool';

/**
 * Aplica `rawDamage` já descontando a armadura e devolve o dano efetivo.
 * Se a vida chegar a zero, o inimigo volta para o pool e `enemyKilled` é emitido.
 */
export function damageEnemy(
  ctx: TickContext,
  data: EnemyData,
  enemy: Enemy,
  rawDamage: number,
  towerId: number | null,
): number {
  const type = getEnemyType(data, enemy.type);
  const damage = applyArmor(rawDamage, type.armor, data.armor);
  enemy.hp -= damage;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    releaseEnemy(ctx.state.enemies, enemy);
    ctx.emit({
      type: 'enemyKilled',
      tick: ctx.state.tick,
      enemyId: enemy.id,
      enemyType: enemy.type,
      towerId,
    });
  }
  return damage;
}
