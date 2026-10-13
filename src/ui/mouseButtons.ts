/**
 * Botões do mouse nos eventos do navegador (T25), sem DOM nem Phaser.
 *
 * Com um botão já apertado, apertar ou soltar outro ("acorde") não dispara
 * `pointerdown`/`pointerup`: chega só como `pointermove`, com o botão que
 * mudou em `button` e os apertados em `buttons`.
 */

/** Botões do mouse, como em `event.button`. */
export const MouseButton = { left: 0, middle: 1, right: 2 } as const;

/** Bit de cada botão em `event.buttons` (esquerdo 1, direito 2, meio 4). */
function buttonMask(button: number): number {
  if (button === MouseButton.left) return 1;
  if (button === MouseButton.right) return 2;
  if (button === MouseButton.middle) return 4;
  return 0;
}

/** O botão está apertado segundo `event.buttons`? */
export function isButtonDown(buttons: number, button: number): boolean {
  return (buttons & buttonMask(button)) !== 0;
}

/**
 * Aperto do próprio botão esquerdo. Com outro botão já apertado, o aperto do
 * direito ou do meio também tem o esquerdo em `buttons`: sem olhar `button`,
 * ele viraria um clique esquerdo (seleção, compra, arrasto).
 */
export function isLeftPress(button: number, buttons: number): boolean {
  return button === MouseButton.left && isButtonDown(buttons, MouseButton.left);
}

/**
 * Botão que mudou num `pointermove` (um 2º botão apertado ou solto com outro
 * já apertado só chega assim) e se ele ficou apertado; `null` se nada mudou.
 */
export function chordChange(
  button: number,
  buttons: number,
): { button: number; pressed: boolean } | null {
  if (buttonMask(button) === 0) return null;
  return { button, pressed: isButtonDown(buttons, button) };
}
