/**
 * Telas de fim de run (vitória e derrota), em HTML sobre o canvas, com as
 * mesmas estatísticas: onda, tempo de jogo, abates e a maior cadeia. Desde a
 * T17: semente, marcação de trapaça, "Copiar link da run" e "Copiar relatório".
 */

import { formatRunReport, formatTime, type RunSummary } from './runReport';

/** Copia o texto; sem permissão, mostra a caixa de texto selecionada para copiar à mão. */
async function copyText(text: string, fallback: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    fallback.hidden = true;
    return true;
  } catch {
    fallback.value = text;
    fallback.hidden = false;
    fallback.select();
    return false;
  }
}

/** Mostra a tela e devolve a função que a remove. */
export function showEndScreen(
  parent: HTMLElement,
  info: RunSummary,
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
    `Abates: ${info.kills} · Maior cadeia: x${info.longestChain}`;

  const seed = document.createElement('p');
  seed.className = 'end-seed';
  seed.textContent = `Semente: ${info.seed} · Versão: ${info.version}`;

  const cheated = document.createElement('p');
  cheated.className = 'end-cheated';
  cheated.textContent = 'Run com trapaças';
  cheated.hidden = !info.cheated;

  const note = document.createElement('p');
  note.className = 'end-note';
  const fallback = document.createElement('textarea');
  fallback.className = 'end-fallback';
  fallback.readOnly = true;
  fallback.hidden = true;

  const copyButton = (text: string, content: () => string, done: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'end-secondary';
    b.textContent = text;
    b.addEventListener('click', () => {
      void copyText(content(), fallback).then((ok) => {
        note.textContent = ok ? done : 'Não consegui copiar: selecione o texto abaixo (Ctrl+C).';
      });
    });
    return b;
  };
  const copyLink = copyButton('Copiar link da run', () => info.link, 'Link copiado.');
  const copyReport = copyButton(
    'Copiar relatório',
    () => formatRunReport(info),
    'Relatório copiado.',
  );

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.textContent = 'Jogar de novo';
  restart.addEventListener('click', onRestart);

  const copies = document.createElement('div');
  copies.className = 'end-copies';
  copies.append(copyLink, copyReport);

  panel.append(title, summary, seed, cheated, copies, note, fallback, restart);
  overlay.append(panel);
  parent.append(overlay);
  restart.focus();

  return () => overlay.remove();
}
