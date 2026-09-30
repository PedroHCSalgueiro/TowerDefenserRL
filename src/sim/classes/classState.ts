/**
 * Parte do `RunState` que pertence às classes: para cada uma, as torres
 * diferentes que contam e o nível de bônus ativo. Vai para o save.
 *
 * O sistema de classes (`systems.ts`) recalcula isto no fim de cada tick.
 * Como todo o resto do tick já leu o valor antigo, posicionar, vender ou
 * fundir uma torre liga ou desliga o bônus no tick seguinte.
 */

import type { ClassData } from './classData';

export interface ClassStatus {
  /** Níveis atingidos: 0 = sem bônus, 1 = primeiro nível dos dados, e assim por diante. */
  level: number;
  /** Tipos de torre diferentes no mapa que têm a classe, em ordem alfabética. */
  members: string[];
}

/** Por id de classe, na ordem do `classes.json`. */
export type ClassState = Record<string, ClassStatus>;

export function createClassState(data: ClassData): ClassState {
  const state: ClassState = {};
  for (const id of data.ids) state[id] = { level: 0, members: [] };
  return state;
}
