/**
 * Aplicar dano a um inimigo: armadura, morte e evento. Toda fonte de dano
 * (núcleo, projéteis das torres e efeitos de gatilho) passa por aqui.
 */

import type { TickContext } from '../engine/simulation';
import { applyArmor } from './armor';
import { getEnemyType, type EnemyData } from './enemyData';
import { releaseEnemy, type Enemy } from './pool';
import { NO_CHAIN, type ChainMark } from '../triggers/triggerState';

export interface DamageOptions {
  /** Ignora a armadura (execução). */
  readonly ignoreArmor?: boolean;
  /** Quanto o abate vale nos contadores de abate (padrão 1; execução usa o valor dos dados). */
  readonly killWeight?: number;
  /** Cadeia do tiro (projétil disparado por um gatilho); padrão: sem cadeia. */
  readonly chain?: ChainMark;
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
    const chain = options?.chain ?? NO_CHAIN;
    enemy.hp = 0;
    releaseEnemy(ctx.state.enemies, enemy);
    ctx.emit({
      type: 'enemyKilled',
      tick: ctx.state.tick,
      enemyId: enemy.id,
      enemyType: enemy.type,
      wave: enemy.wave,
      towerId,
      x: enemy.x,
      y: enemy.y,
      weight: options?.killWeight ?? 1,
      chainId: chain.chainId,
      originTowerId: chain.originTowerId,
    });
  }
  return damage;
}
