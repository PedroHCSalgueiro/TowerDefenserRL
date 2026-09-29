/**
 * Números do núcleo, lidos de `src/data/nexus.json`. O alcance é em casas,
 * medido do centro do núcleo até a posição do inimigo.
 */

import nexusJson from '../../data/nexus.json';

export interface NexusData {
  readonly maxHp: number;
  readonly attack: {
    readonly damage: number;
    readonly cooldownSeconds: number;
    readonly range: number;
  };
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function loadNexusData(raw: unknown): NexusData {
  const data = raw as Partial<NexusData> | null;
  const attack = data?.attack;
  if (
    !isPositive(data?.maxHp) ||
    !attack ||
    !isPositive(attack.damage) ||
    !isPositive(attack.cooldownSeconds) ||
    !isPositive(attack.range)
  ) {
    throw new Error('Dados do núcleo inválidos: campos ausentes ou não positivos');
  }
  return {
    maxHp: data.maxHp,
    attack: {
      damage: attack.damage,
      cooldownSeconds: attack.cooldownSeconds,
      range: attack.range,
    },
  };
}

export const nexusData: NexusData = loadNexusData(nexusJson);
