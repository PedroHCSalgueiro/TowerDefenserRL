/** Quais torres recebem o flash de fusão no quadro (sem Phaser, para testar). */

import type { SimEvent } from '../../sim/engine/events';

/**
 * Onde sai flash nos eventos do quadro: uma vez por sobrevivente final. Uma
 * fusão cujo `towerId` foi absorvido por outra fusão do mesmo quadro (a ★1 da
 * cascata) não recebe flash.
 */
export function fusionFlashes(
  events: readonly SimEvent[],
): { towerId: number; x: number; y: number }[] {
  const absorbed = new Set<number>();
  for (const event of events) {
    if (event.type === 'towersMerged') for (const id of event.absorbedIds) absorbed.add(id);
  }
  const flashes: { towerId: number; x: number; y: number }[] = [];
  for (const event of events) {
    if (event.type === 'towersMerged' && !absorbed.has(event.towerId)) {
      flashes.push({ towerId: event.towerId, x: event.x, y: event.y });
    }
  }
  return flashes;
}
