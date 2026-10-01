/**
 * Telas de fim de run (vitória e derrota), em HTML sobre o canvas, com as
 * mesmas estatísticas: onda, tempo de jogo e abates.
 */

export interface EndInfo {
  won: boolean;
  /** Onda alcançada (a em andamento na derrota; a última na vitória). */
  wave: number;
  totalWaves: number;
  seconds: number;
  kills: number;
  seed: string;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** Mostra a tela e devolve a função que a remove. */
export function showEndScreen(
  parent: HTMLElement,
  info: EndInfo,
  onRestart: () => void,
): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'end-screen';

  const panel = document.createElement('div');
  panel.className = info.won ? 'end-panel end-won' : 'end-panel';

  const title = document.createElement('h1');
  title.textContent = info.won ? 'Vitória!' : 'O núcleo caiu';

  const summary = document.createElement('p');
  summary.textContent =
    `Onda ${info.wave}/${info.totalWaves} · Tempo: ${formatTime(info.seconds)} · ` +
    `Abates: ${info.kills}`;

  const seed = document.createElement('p');
  seed.className = 'end-seed';
  seed.textContent = `Semente: ${info.seed}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Jogar de novo';
  button.addEventListener('click', onRestart);

  panel.append(title, summary, seed, button);
  overlay.append(panel);
  parent.append(overlay);
  button.focus();

  return () => overlay.remove();
}
