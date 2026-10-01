/**
 * Debug escondido na build de playtest (T17). O painel F2 e as trapaças
 * aparecem no `npm run dev`, com `?debug=1` na URL ou depois do atalho
 * secreto Ctrl+Shift+D, que vale para a sessão do navegador.
 */

import debugConfig from '../data/debug.json';

const { unlockKey, unlockParam, unlockSessionKey } = debugConfig.panel;

export interface DebugUnlockInput {
  /** `import.meta.env.DEV`: servidor de desenvolvimento. */
  dev: boolean;
  /** `window.location.search`. */
  search: string;
  /** O atalho já foi usado nesta sessão. */
  sessionUnlocked: boolean;
}

/** O debug está liberado? */
export function debugUnlocked({ dev, search, sessionUnlocked }: DebugUnlockInput): boolean {
  return dev || sessionUnlocked || new URLSearchParams(search).get(unlockParam) === '1';
}

/** A tecla é o atalho secreto (Ctrl+Shift+D)? */
export function isUnlockShortcut(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'key' | 'code'>,
): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key.toUpperCase() === unlockKey || event.code === `Key${unlockKey}`)
  );
}

/** Lê a liberação da sessão; sem `sessionStorage` (bloqueado), fica travado. */
export function readSessionUnlock(storage: () => Storage): boolean {
  try {
    return storage().getItem(unlockSessionKey) === '1';
  } catch {
    return false;
  }
}

/** Guarda a liberação para a sessão (se o navegador deixar). */
export function writeSessionUnlock(storage: () => Storage): void {
  try {
    storage().setItem(unlockSessionKey, '1');
  } catch {
    // Sem armazenamento: vale só até recarregar a página.
  }
}

/**
 * Estado da liberação no navegador: começa pelo dev, pela URL ou pela sessão,
 * e o atalho libera na hora (avisando quem estiver ouvindo).
 */
export class DebugGate {
  private open: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!isUnlockShortcut(event)) return;
    // Sem isso, o navegador abriria o "favoritar todas as abas".
    event.preventDefault();
    if (event.repeat || this.open) return;
    this.open = true;
    writeSessionUnlock(() => window.sessionStorage);
    for (const listener of this.listeners) listener();
  };

  constructor(dev: boolean, search: string) {
    this.open = debugUnlocked({
      dev,
      search,
      sessionUnlocked: readSessionUnlock(() => window.sessionStorage),
    });
    window.addEventListener('keydown', this.onKeyDown);
  }

  get unlocked(): boolean {
    return this.open;
  }

  /** Chamado uma vez, quando o atalho liberar o debug. Devolve a função que desliga. */
  onUnlock(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.listeners.clear();
  }
}
