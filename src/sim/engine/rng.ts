/**
 * RNG determinístico com semente (mulberry32).
 *
 * Todo o estado do gerador é um único inteiro de 32 bits guardado em
 * `holder.rngState` (normalmente o próprio RunState). Assim o estado salvo
 * em JSON continua a mesma sequência ao ser restaurado.
 */

export interface RngHolder {
  rngState: number;
}

/** Converte uma semente em texto num inteiro de 32 bits (FNV-1a). */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export class Rng {
  private readonly holder: RngHolder;

  constructor(holder: RngHolder) {
    this.holder = holder;
  }

  /** Número em [0, 1). */
  nextFloat(): number {
    const t = (this.holder.rngState + 0x6d2b79f5) >>> 0;
    this.holder.rngState = t;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [min, max], inclusive nas duas pontas. */
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`nextInt: intervalo inválido [${min}, ${max}]`);
    }
    return min + Math.floor(this.nextFloat() * (max - min + 1));
  }

  /** Verdadeiro com probabilidade `p` (0 a 1). */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick: lista vazia');
    }
    return items[this.nextInt(0, items.length - 1)] as T;
  }

  /** Embaralha no lugar (Fisher-Yates) e devolve o próprio array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
    return items;
  }
}
