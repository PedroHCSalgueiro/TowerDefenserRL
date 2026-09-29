/**
 * Números das ferramentas de debug da simulação, lidos de
 * `src/data/debug.json`: limite de spawn por ação.
 */

import debugJson from '../../data/debug.json';

export interface SimDebugData {
  /** Teto de inimigos ou torres criados por uma única ação de debug. */
  readonly maxSpawnPerCommand: number;
}

export function loadSimDebugData(raw: unknown): SimDebugData {
  const data = raw as Partial<SimDebugData> | null;
  const max = data?.maxSpawnPerCommand;
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    throw new Error('Dados de debug inválidos: "maxSpawnPerCommand" precisa ser inteiro positivo');
  }
  return { maxSpawnPerCommand: max };
}

export const simDebugData: SimDebugData = loadSimDebugData(debugJson);
