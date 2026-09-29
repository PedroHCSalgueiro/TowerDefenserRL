/**
 * Aplicar dano a um inimigo: armadura, morte e evento. Toda fonte de dano
 * (núcleo, projéteis das torres e efeitos de gatilho) passa por aqui.
 */

import type { TickContext } from '../engine/simulation';
import { applyArmor } from './armor';
import { getEnemyType, type EnemyData } from './enemyData';
import { releaseEnemy, type Enemy } from './pool';

export interface DamageOptions {
  /** Ignora a armadura (execução). */
  readonly ignoreArmor?: boolean;
  /** Quanto o abate vale nos contadores de abate (padrão 1; execução usa o valor dos dados). */
  readonly killWeight?: number;
}

/**
 * Aplica `rawDamage` já descontando a armadura e devolve o dano efetivo.
 * Se a vida chegar a zero, o inimigo volta para o pool e `enemyKilled` é
 * emitido, com o ponto da morte e o peso do abate.
 */
export function damageEnemy(
  ctx: TickContext,
  data: EnemyData,
  enemy: Enemy,
  rawDamage: number,
  towerId: number | null,
  options?: DamageOptions,
): number {
  const type = getEnemyType(data, enemy.type);
  const damage = options?.ignoreArmor ? rawDamage : applyArmor(rawDamage, type.armor, data.armor);
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
      x: enemy.x,
      y: enemy.y,
      weight: options?.killWeight ?? 1,
    });
  }
  return damage;
}
