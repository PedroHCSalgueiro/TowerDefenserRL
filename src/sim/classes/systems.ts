/**
 * Sistema de classes, o último do tick: conta as torres diferentes de cada
 * classe no mapa e atualiza o nível de bônus em `RunState.classes`.
 *
 * Conta tipos de torre, não torres: cópias não somam, e fundir (que mantém o
 * tipo) nunca reduz o bônus. As duas classes de cada torre contam. Como roda
 * depois de tudo, o bônus muda no tick seguinte à mudança das torres.
 */

import type { System } from '../engine/simulation';
import { getTowerType, type TowerData } from '../towers/towerData';
import type { ClassData } from './classData';

/**
 * Torres diferentes de cada classe e o nível ativo, para um conjunto de tipos
 * no mapa. É a contagem do sistema e da prévia de classes da loja (T16).
 */
export function countClasses(
  types: Iterable<string>,
  towers: TowerData,
  classes: ClassData,
): Record<string, { members: string[]; level: number }> {
  const sortedTypes = [...new Set(types)].sort();
  const result: Record<string, { members: string[]; level: number }> = {};
  for (const id of classes.ids) {
    const members = sortedTypes.filter((t) => getTowerType(towers, t).classes.includes(id));
    let level = 0;
    for (const l of classes.classes[id]!.levels) if (members.length >= l.count) level++;
    result[id] = { members, level };
  }
  return result;
}

export function createClassSystem(towers: TowerData, classes: ClassData): System {
  return (ctx) => {
    const { state } = ctx;
    const counted = countClasses(
      state.towers.map((t) => t.type),
      towers,
      classes,
    );
    for (const id of classes.ids) {
      const status = state.classes[id]!;
      const { members, level } = counted[id]!;
      status.members = members;
      if (level !== status.level) {
        const previousLevel = status.level;
        status.level = level;
        ctx.emit({
          type: 'classLevelChanged',
          tick: state.tick,
          classId: id,
          level,
          previousLevel,
          count: members.length,
        });
      }
    }
  };
}
