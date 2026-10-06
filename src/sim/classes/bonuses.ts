/**
 * Leitura dos bônus de classe. Cada bônus vale só para as torres da própria
 * classe: as funções percorrem as classes do tipo da torre que age e olham o
 * nível ativo de cada uma (`RunState.classes`). Sem nível ativo, o valor é
 * neutro. Nada aqui aloca objetos: roda a cada tiro e a cada abate.
 *
 * Os bônus de classe das recompensas (T24) entram aqui também: +% de dano
 * da área, −N nas contagens "a cada N" e o peso das mortes de elite e chefão.
 * Estados sem `rewards` (testes) valem como sem recompensas.
 */

import { rewardMods } from '../rewards/mods';
import type { RewardsState } from '../rewards/rewardState';
import type { RunState } from '../state';
import type { TowerType } from '../towers/towerData';
import type { ClassData, ClassLevel } from './classData';

/** O que os bônus leem do estado: as classes e, se houver, as recompensas. */
export type BonusState = Pick<RunState, 'classes'> & { readonly rewards?: RewardsState };

/** Nível ativo da classe, ou `null` se ainda não chegou ao primeiro. */
export function activeLevel(
  data: ClassData,
  state: BonusState,
  classId: string,
): ClassLevel | null {
  const level = state.classes[classId]?.level ?? 0;
  return level > 0 ? (data.classes[classId]?.levels[level - 1] ?? null) : null;
}

/** Artilharia: multiplicador do raio da área (tiro em área e explosões de gatilho). */
export function areaRadiusMultiplier(data: ClassData, state: BonusState, type: TowerType): number {
  let mult = 1;
  for (const id of type.classes) mult *= activeLevel(data, state, id)?.areaRadiusMultiplier ?? 1;
  return mult;
}

/**
 * Artilharia: multiplicador do dano da área (tiro em área e explosões de
 * gatilho). O bônus das recompensas multiplica junto: +25% duas vezes = ×1,5.
 */
export function areaDamageMultiplier(data: ClassData, state: BonusState, type: TowerType): number {
  const extra = rewardMods(state).areaDamagePercent;
  let mult = 1;
  for (const id of type.classes) {
    mult *= activeLevel(data, state, id)?.areaDamageMultiplier ?? 1;
    const percent = extra[id];
    if (percent) mult *= 1 + percent / 100;
  }
  return mult;
}

/**
 * Mecânica: contagem de um "a cada N" depois do desconto. Arredonda para
 * baixo, nunca passa de `base` e nunca cai abaixo do mínimo dos dados. O
 * desconto é aplicado sobre o N da estrela; a conta é em inteiros. Depois
 * dele, a carta da Mecânica das recompensas (T24) tira mais N, com o mesmo mínimo.
 */
export function reducedTriggerCount(
  data: ClassData,
  state: BonusState,
  type: TowerType,
  base: number,
): number {
  const minus = rewardMods(state).triggerCountMinus;
  let percent = 0;
  let extra = 0;
  for (const id of type.classes) {
    percent = Math.max(percent, activeLevel(data, state, id)?.triggerCountReductionPercent ?? 0);
    extra += minus[id] ?? 0;
  }
  if (percent === 0 && extra === 0) return base;
  const reduced = Math.floor((base * (100 - percent)) / 100) - extra;
  return Math.min(base, Math.max(data.minTriggerCount, reduced));
}

/** Arcana: raio da vizinhança quadrada da torre (0 = vizinhança dos dados). */
export function neighborhoodRadius(data: ClassData, state: BonusState, type: TowerType): number {
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
 * resultado do bônus de classe nunca passa do teto dos dados.
 *
 * Carta da Sombria das recompensas (T24): a morte de elite ou chefão
 * (`eliteOrBoss`) vale ×3 para o ouvinte da classe, depois do teto (o teto
 * segura o bônus de classe; a morte de elite vale o triplo do que valeria).
 */
export function killWeight(
  data: ClassData,
  state: BonusState,
  listener: TowerType,
  killerType: TowerType | null,
  base: number,
  eliteOrBoss = false,
): number {
  let weight = base;
  for (const id of listener.classes) {
    const level = activeLevel(data, state, id);
    if (!level || level.killWeightMultiplier === 1) continue;
    if (level.killWeightFrom === 'sameClass' && !killerType?.classes.includes(id)) continue;
    weight *= level.killWeightMultiplier;
  }
  if (weight !== base) weight = Math.min(weight, data.maxKillWeight);
  if (eliteOrBoss) {
    const elite = rewardMods(state).eliteKillWeight;
    for (const id of listener.classes) weight *= elite[id] ?? 1;
  }
  return weight;
}
