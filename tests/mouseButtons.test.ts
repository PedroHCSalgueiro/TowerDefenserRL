import { describe, expect, it } from 'vitest';
import { MouseButton, chordChange, isButtonDown, isLeftPress } from '../src/ui/mouseButtons';

// `buttons`: esquerdo 1, direito 2, meio 4 (como no navegador).
describe('botões do mouse (T25)', () => {
  it('isButtonDown lê o bit de cada botão', () => {
    expect(isButtonDown(1, MouseButton.left)).toBe(true);
    expect(isButtonDown(2, MouseButton.right)).toBe(true);
    expect(isButtonDown(4, MouseButton.middle)).toBe(true);
    expect(isButtonDown(3, MouseButton.middle)).toBe(false);
    expect(isButtonDown(0, MouseButton.left)).toBe(false);
    expect(isButtonDown(7, 3)).toBe(false); // botão "voltar": não conta
  });

  it('só o aperto do próprio esquerdo é clique esquerdo', () => {
    expect(isLeftPress(MouseButton.left, 1)).toBe(true);
    // Direito ou meio apertado com o esquerdo já segurando: não é clique esquerdo.
    expect(isLeftPress(MouseButton.right, 3)).toBe(false);
    expect(isLeftPress(MouseButton.middle, 5)).toBe(false);
    // Ctrl+clique do macOS (o Phaser troca para o direito): não é esquerdo.
    expect(isLeftPress(MouseButton.left, 2)).toBe(false);
  });

  it('acorde: o botão que mudou num pointermove e se ficou apertado', () => {
    // Movimento comum (button −1): nada mudou.
    expect(chordChange(-1, 1)).toBeNull();
    // Direito apertado com o esquerdo segurando.
    expect(chordChange(MouseButton.right, 3)).toEqual({ button: MouseButton.right, pressed: true });
    // Esquerdo solto com o direito ainda apertado.
    expect(chordChange(MouseButton.left, 2)).toEqual({ button: MouseButton.left, pressed: false });
    // Meio apertado com o esquerdo segurando.
    expect(chordChange(MouseButton.middle, 5)).toEqual({
      button: MouseButton.middle,
      pressed: true,
    });
  });
});
