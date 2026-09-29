/**
 * Ataque das torres: com a recarga pronta, a torre escolhe o alvo pelo seu
 * modo de mira (dentro do alcance) e dispara um projétil. O dano só acontece
 * no impacto (`src/sim/projectiles/`), sempre por `damageEnemy()` com o id
 * da torre.
 *
 * A cadência vira um número inteiro de ticks entre disparos (arredondado,
 * no mínimo 1). Sem alvo, a torre espera pronta.
 */

import type { System } from '../engine/simulation';
import { fireProjectile } from '../projectiles/systems';
import type { SpatialIndex } from '../spatial/spatialIndex';
import type { TargetScores } from './targeting';
import { getTowerType, type TowerData } from './towerData';

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
      const score = scores[type.targetMode];
      const target = index.findBest(state, tower.x, tower.y, type.range, score);
      if (!target) continue;

      tower.cooldownTicks = cooldownTicks.get(tower.type)!;
      ctx.emit({ type: 'towerFired', tick: state.tick, towerId: tower.id, targetId: target.id });
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
  };
}
