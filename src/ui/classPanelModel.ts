/**
 * Modelo do painel de classes: transforma o estado (`RunState.classes`) e os
 * dados em linhas prontas para mostrar. Sem DOM, para testar direto. O
 * coringa das recompensas (T24) entra na contagem e aparece como "Coringa"
 * na lista de torres.
 */

import uiConfig from '../data/ui.json';
import type { ClassData } from '../sim/classes/classData';
import type { ClassState } from '../sim/classes/classState';
import type { TowerData } from '../sim/towers/towerData';

export interface ClassLevelRow {
  count: number;
  text: string;
  /** É o nível ativo agora. */
  active: boolean;
}

export interface ClassRow {
  id: string;
  name: string;
  /** Torres diferentes com a classe no mapa, mais o coringa. */
  count: number;
  /** Torres para o próximo nível; `null` se já está no último. */
  next: number | null;
  /** Nível ativo (0 = nenhum). */
  level: number;
  /** "Arcana 3/4" ou "Arcana 5 · máx." */
  label: string;
  levels: ClassLevelRow[];
  /** Nomes das torres que estão contando. */
  members: string[];
}

export function buildClassRows(
  state: Readonly<ClassState>,
  classes: ClassData,
  towers: TowerData,
  wildcards: Readonly<Record<string, number>> = {},
): ClassRow[] {
  return classes.ids.map((id) => {
    const data = classes.classes[id]!;
    const status = state[id] ?? { level: 0, members: [] };
    const extra = wildcards[id] ?? 0;
    const count = status.members.length + extra;
    const next = data.levels.find((l) => l.count > count)?.count ?? null;
    return {
      id,
      name: data.name,
      count,
      next,
      level: status.level,
      label: next === null ? `${data.name} ${count} · máx.` : `${data.name} ${count}/${next}`,
      levels: data.levels.map((l, i) => ({
        count: l.count,
        text: l.text,
        active: status.level === i + 1,
      })),
      members: [
        ...status.members.map((type) => towers.types[type]?.name ?? type),
        ...Array.from({ length: extra }, () => uiConfig.rewardScreen.wildcardMember),
      ],
    };
  });
}

/** Assinatura das linhas: a interface só mexe no DOM quando ela muda. */
export function classRowsKey(rows: readonly ClassRow[]): string {
  return rows.map((r) => `${r.id}:${r.level}:${r.count}:${r.members.join(',')}`).join('|');
}
