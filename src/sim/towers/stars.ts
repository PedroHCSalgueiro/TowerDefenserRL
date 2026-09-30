/**
 * Estrela da torre. Até a T11 (fusão) a estrela só vem do spawn do debug;
 * cada estrela traz o gatilho com os seus números (`stars` do gatilho).
 * Torre sem gatilho só tem ★1.
 */

import { triggerAt, type TriggerStar } from '../triggers/triggerData';
import type { Tower } from './placement';
import type { TowerType } from './towerData';

/** Estrelas que o tipo tem em dados (1 se não tem gatilho). */
export function maxStars(type: TowerType): number {
  return type.trigger?.stars.length ?? 1;
}

/** Estrela pedida, presa entre ★1 e a última que o tipo tem. */
export function clampStar(type: TowerType, star: number): number {
  const wanted = Number.isFinite(star) ? Math.floor(star) : 1;
  return Math.min(Math.max(1, wanted), maxStars(type));
}

/** Gatilho da torre na estrela dela (`null` = tipo sem gatilho). */
export function towerStar(type: TowerType, tower: Tower): TriggerStar | null {
  return type.trigger ? triggerAt(type.trigger, clampStar(type, tower.star)) : null;
}

/** Dano do ataque normal da torre: o dano dos dados com o bônus da estrela. */
export function towerDamage(type: TowerType, tower: Tower): number {
  const star = type.trigger ? towerStar(type, tower) : null;
  return star && star.attackDamagePercent !== 100
    ? (type.damage * star.attackDamagePercent) / 100
    : type.damage;
}
