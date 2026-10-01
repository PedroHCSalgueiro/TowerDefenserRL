/**
 * Semente da run pela URL: `?seed=abc` fixa a semente (para reproduzir bugs
 * e combos). Sem o parâmetro, a semente continua sorteada.
 */

const SEED_PARAM = 'seed';

/** Semente de `?seed=...`, sem espaços nas pontas; `null` se ausente ou vazia. */
export function seedFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SEED_PARAM)?.trim();
  return value ? value : null;
}

/** Semente fixada pela URL ou, sem ela, a sorteada por `fallback`. */
export function resolveSeed(search: string, fallback: () => string): string {
  return seedFromSearch(search) ?? fallback();
}

/** O endereço atual com `?seed=` apontando para `seed` (os outros parâmetros ficam). */
export function linkWithSeed(href: string, seed: string): string {
  const url = new URL(href);
  url.searchParams.set(SEED_PARAM, seed);
  return url.toString();
}

/**
 * Link da run para a tela de fim (T17): o endereço com `?seed=`, sem o
 * `?debug=1`, para quem receber o link não abrir o debug sem querer.
 */
export function runLink(href: string, seed: string, debugParam = 'debug'): string {
  const url = new URL(linkWithSeed(href, seed));
  url.searchParams.delete(debugParam);
  return url.toString();
}
