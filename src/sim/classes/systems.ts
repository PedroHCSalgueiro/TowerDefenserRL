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

export function createClassSystem(towers: TowerData, classes: ClassData): System {
  const present = new Set<string>();
  return (ctx) => {
    const { state } = ctx;
    present.clear();
    for (const tower of state.towers) present.add(tower.type);
    const sortedTypes = [...present].sort();

    for (const id of classes.ids) {
      const status = state.classes[id]!;
      const members = sortedTypes.filter((t) => getTowerType(towers, t).classes.includes(id));
      status.members = members;
      let level = 0;
      for (const l of classes.classes[id]!.levels) if (members.length >= l.count) level++;
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
