/** Linhas da tela de ajuda (T17), dos textos em `ui.json`. */

import uiConfig from '../data/ui.json';

export interface HelpLine {
  keys: string;
  action: string;
  debug: boolean;
}

/** Os controles do jogo; F2 e Ctrl+Shift+D só com o debug liberado. */
export function helpLines(debugUnlocked: boolean, help = uiConfig.help): HelpLine[] {
  const lines = help.controls.map((c) => ({ ...c, debug: false }));
  if (debugUnlocked) lines.push(...help.debugControls.map((c) => ({ ...c, debug: true })));
  return lines;
}
