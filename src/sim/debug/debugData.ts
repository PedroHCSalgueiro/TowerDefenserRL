/**
 * Números das ferramentas de debug da simulação, lidos de
 * `src/data/debug.json`: limite de spawn e de ouro por ação.
 */

import debugJson from '../../data/debug.json';

export interface SimDebugData {
  /** Teto de inimigos ou torres criados por uma única ação de debug. */
  readonly maxSpawnPerCommand: number;
  /** Teto de ouro somado por um único "+ouro" do debug (T17). */
  readonly maxGoldPerCommand: number;
}

export function loadSimDebugData(raw: unknown): SimDebugData {
  const data = raw as Partial<SimDebugData> | null;
  const positiveInt = (key: keyof SimDebugData): number => {
    const value = data?.[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error(`Dados de debug inválidos: "${key}" precisa ser inteiro positivo`);
    }
    return value;
  };
  return {
    maxSpawnPerCommand: positiveInt('maxSpawnPerCommand'),
    maxGoldPerCommand: positiveInt('maxGoldPerCommand'),
  };
}

export const simDebugData: SimDebugData = loadSimDebugData(debugJson);
