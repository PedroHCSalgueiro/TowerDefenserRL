/**
 * Leitura dos bônus de classe. Cada bônus vale só para as torres da própria
 * classe: as funções percorrem as classes do tipo da torre que age e olham o
 * nível ativo de cada uma (`RunState.classes`). Sem nível ativo, o valor é
 * neutro. Nada aqui aloca objetos: roda a cada tiro e a cada abate.
 */

import type { RunState } from '../state';
import type { TowerType } from '../towers/towerData';
import type { ClassData, ClassLevel } from './classData';

/** Nível ativo da classe, ou `null` se ainda não chegou ao primeiro. */
export function activeLevel(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  classId: string,
): ClassLevel | null {
  const level = state.classes[classId]?.level ?? 0;
  return level > 0 ? (data.classes[classId]?.levels[level - 1] ?? null) : null;
}

/** Artilharia: multiplicador do raio da área (tiro em área e explosões de gatilho). */
export function areaRadiusMultiplier(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  type: TowerType,
): number {
  let mult = 1;
  for (const id of type.classes) mult *= activeLevel(data, state, id)?.areaRadiusMultiplier ?? 1;
  return mult;
}

/** Artilharia: multiplicador do dano da área (tiro em área e explosões de gatilho). */
export function areaDamageMultiplier(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  type: TowerType,
): number {
  let mult = 1;
  for (const id of type.classes) mult *= activeLevel(data, state, id)?.areaDamageMultiplier ?? 1;
  return mult;
}

/**
 * Mecânica: contagem de um "a cada N" depois do desconto. Arredonda para
 * baixo, nunca passa de `base` e nunca cai abaixo do mínimo dos dados. O
 * desconto é aplicado sobre o N da estrela; a conta é em inteiros.
 */
export function reducedTriggerCount(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  type: TowerType,
  base: number,
): number {
  let percent = 0;
  for (const id of type.classes) {
    percent = Math.max(percent, activeLevel(data, state, id)?.triggerCountReductionPercent ?? 0);
  }
  if (percent === 0) return base;
  const reduced = Math.floor((base * (100 - percent)) / 100);
  return Math.min(base, Math.max(data.minTriggerCount, reduced));
}

/** Arcana: raio da vizinhança quadrada da torre (0 = vizinhança dos dados). */
export function neighborhoodRadius(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  type: TowerType,
): number {
  let radius = 0;
  for (const id of type.classes) {
    radius = Math.max(radius, activeLevel(data, state, id)?.neighborhoodRadius ?? 0);
  }
  return radius;
}

/**
 * Sombria: peso de uma morte nos gatilhos de uma torre que escuta abates.
 * O multiplicador só vale para o ouvinte da classe do bônus, e só para mortes
 * de torres da própria classe (nível 2) ou de qualquer autor (nível 4).
 * `killerType` é `null` quando a morte não foi de uma torre (núcleo). O
 * resultado nunca passa do teto dos dados.
 */
export function killWeight(
  data: ClassData,
  state: Pick<RunState, 'classes'>,
  listener: TowerType,
  killerType: TowerType | null,
  base: number,
): number {
  let weight = base;
  for (const id of listener.classes) {
    const level = activeLevel(data, state, id);
    if (!level || level.killWeightMultiplier === 1) continue;
    if (level.killWeightFrom === 'sameClass' && !killerType?.classes.includes(id)) continue;
    weight *= level.killWeightMultiplier;
  }
  return weight === base ? base : Math.min(weight, data.maxKillWeight);
}
