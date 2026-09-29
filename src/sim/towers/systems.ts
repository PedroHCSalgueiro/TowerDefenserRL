/**
 * Ataque das torres: com a recarga pronta, a torre escolhe o alvo pelo seu
 * modo de mira (dentro do alcance) e dispara um projétil. O dano só acontece
 * no impacto (`src/sim/projectiles/`), sempre por `damageEnemy()` com o id
 * da torre.
 *
 * A cadência vira um número inteiro de ticks entre disparos (arredondado,
 * no mínimo 1). Sem alvo, a torre espera pronta.
 *
 * `findTowerTarget` e `fireTowerShot` também são usados pelo motor de
 * gatilhos (tiro de ativação e disparo múltiplo).
 */

import type { Enemy } from '../enemies/pool';
import type { ShotKind } from '../engine/events';
import type { System, TickContext } from '../engine/simulation';
import { fireProjectile } from '../projectiles/systems';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { RunState } from '../state';
import type { Tower } from './placement';
import type { TargetScores } from './targeting';
import { getTowerType, type TowerData, type TowerType } from './towerData';

/** O alvo normal da torre agora: o melhor pelo modo de mira, dentro do alcance. */
export function findTowerTarget(
  index: SpatialIndex,
  state: RunState,
  tower: Tower,
  type: TowerType,
  scores: TargetScores,
): Enemy | null {
  return index.findBest(state, tower.x, tower.y, type.range, scores[type.targetMode]);
}

/** Emite `towerFired` e cria o projétil da torre mirando `target`. */
export function fireTowerShot(
  ctx: TickContext,
  tower: Tower,
  type: TowerType,
  target: Enemy,
  shot: ShotKind,
): void {
  ctx.emit({
    type: 'towerFired',
    tick: ctx.state.tick,
    towerId: tower.id,
    targetId: target.id,
    shot,
  });
  fireProjectile(
    ctx,
    {
      sourceId: tower.id,
      x: tower.x,
      y: tower.y,
      damage: type.damage,
      speed: type.projectileSpeed,
      areaRadius: type.shot.kind === 'area' ? type.shot.radius : 0,
    },
    target,
  );
}

export function createTowerSystem(
  index: SpatialIndex,
  data: TowerData,
  scores: TargetScores,
  ticksPerSecond: number,
): System {
  const cooldownTicks = new Map<string, number>();
  for (const [id, type] of Object.entries(data.types)) {
    cooldownTicks.set(id, Math.max(1, Math.round(ticksPerSecond / type.shotsPerSecond)));
  }

  return (ctx) => {
    const { state } = ctx;
    for (const tower of state.towers) {
      if (tower.cooldownTicks > 0) tower.cooldownTicks--;
      if (tower.cooldownTicks > 0) continue;

      const type = getTowerType(data, tower.type);
      const target = findTowerTarget(index, state, tower, type, scores);
      if (!target) continue;

      tower.cooldownTicks = cooldownTicks.get(tower.type)!;
      fireTowerShot(ctx, tower, type, target, 'normal');
    }
  };
}
