/**
 * Chaves de debug pela URL. `?fx=0` desliga o feedback visual dos gatilhos
 * (T16: linhas, flash, contador de cadeia e números), para medir o custo
 * dos efeitos no FPS com o mesmo cenário.
 */

/** Os efeitos dos gatilhos estão desligados por `?fx=0`? */
export function triggerFxDisabled(search: string): boolean {
  return new URLSearchParams(search).get('fx') === '0';
}
