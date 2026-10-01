/**
 * Modo estresse (debug): mantém `count` inimigos ativos. No início de cada
 * tick, repõe quem morreu ou chegou ao núcleo, sorteando o tipo com o RNG da
 * run (por isso continua determinístico em qualquer velocidade).
 */

import type { EnemyData } from '../enemies/enemyData';
import { getEnemyType } from '../enemies/enemyData';
import type { Routes } from '../enemies/route';
import { spawnEnemy } from '../enemies/systems';
import type { System, TickContext } from '../engine/simulation';
import type { DebugLayout } from '../state';

const randomTypeCache = new WeakMap<EnemyData, string[]>();

/** Tipos sorteáveis pelo debug e pelo estresse: todos menos os chefões. */
function randomTypes(data: EnemyData): string[] {
  let types = randomTypeCache.get(data);
  if (!types) {
    types = Object.keys(data.types).filter((id) => !getEnemyType(data, id).boss);
    randomTypeCache.set(data, types);
  }
  return types;
}

/**
 * Cria um inimigo segundo a disposição: `clustered` nasce na entrada;
 * `spread` nasce num ponto sorteado da sua rota. `enemyType` `null` sorteia o
 * tipo entre os que não são chefão (o chefão só vem pelas ondas ou pelo tipo
 * escolhido no painel).
 */
export function spawnDebugEnemy(
  ctx: TickContext,
  routes: Routes,
  data: EnemyData,
  enemyType: string | null,
  layout: DebugLayout,
): void {
  const typeId = enemyType ?? ctx.rng.pick(randomTypes(data));
  const route = routes[getEnemyType(data, typeId).movement];
  const distance = layout === 'spread' ? ctx.rng.nextFloat() * route.length : 0;
  spawnEnemy(ctx, routes, data, typeId, distance);
}

export function createStressSystem(routes: Routes, data: EnemyData): System {
  return (ctx) => {
    const { stress } = ctx.state.debug;
    if (!stress) return;
    const { enemies } = ctx.state;
    while (enemies.activeCount < stress.count) {
      spawnDebugEnemy(ctx, routes, data, null, stress.layout);
    }
  };
}
