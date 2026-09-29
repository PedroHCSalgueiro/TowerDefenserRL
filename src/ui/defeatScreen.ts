/**
 * Tela de derrota simples, em HTML sobre o canvas.
 */

export interface DefeatInfo {
  seconds: number;
  seed: string;
}

/** Mostra a tela e devolve a função que a remove. */
export function showDefeatScreen(
  parent: HTMLElement,
  info: DefeatInfo,
  onRestart: () => void,
): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'defeat-screen';

  const panel = document.createElement('div');
  panel.className = 'defeat-panel';

  const title = document.createElement('h1');
  title.textContent = 'O núcleo caiu';

  const summary = document.createElement('p');
  const minutes = Math.floor(info.seconds / 60);
  const seconds = Math.floor(info.seconds % 60)
    .toString()
    .padStart(2, '0');
  summary.textContent = `Tempo: ${minutes}:${seconds} · Semente: ${info.seed}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Jogar de novo';
  button.addEventListener('click', onRestart);

  panel.append(title, summary, button);
  overlay.append(panel);
  parent.append(overlay);
  button.focus();

  return () => overlay.remove();
}
