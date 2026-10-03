/**
 * Mini tutorial da primeira partida (T23), sem DOM: cartões que não pausam o
 * jogo e avançam com as ações do jogador. Textos e tempos em `ui.json`.
 *
 * - `buy`: aparece logo; some quando a primeira torre entra no mapa.
 * - `call`: depois do `buy`; some quando a primeira onda é chamada.
 * - `income`: quando a primeira onda fecha.
 * - `nexus`: quando o limite de torres enche.
 * - `positions`: quando há 2 torres no mapa.
 * Os três últimos fecham com clique ou sozinhos depois de `autoCloseMs`. Só
 * um cartão por vez: o primeiro da lista que pode aparecer. Terminar (ou
 * "Pular tutorial") grava a marca no navegador; sem a marca, recomeça.
 */

import uiData from '../data/ui.json';
import type { RunState } from '../sim/state';
import { currentTowerLimit } from '../sim/towers/limit';

const config = uiData.tutorial;

export type TutorialStepId = 'buy' | 'call' | 'income' | 'nexus' | 'positions';

export interface TutorialCard {
  id: TutorialStepId;
  text: string;
  /** Fecha com clique (e sozinho); os de ação só somem com a ação. */
  closable: boolean;
}

type TutorialState = Pick<RunState, 'towers' | 'wave' | 'waves' | 'nexus'>;

/** Guarda do navegador (o `localStorage`), que pode faltar ou falhar. */
export interface TutorialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Já viu o tutorial? Se ler falhar, responde que não (pode aparecer de novo). */
export function tutorialSeen(storage: TutorialStorage | null): boolean {
  try {
    return storage?.getItem(config.storageKey) === '1';
  } catch {
    return false;
  }
}

/** Grava que viu; se falhar, só não grava. */
export function markTutorialSeen(storage: TutorialStorage | null): void {
  try {
    storage?.setItem(config.storageKey, '1');
  } catch {
    // Sem a marca, o tutorial pode aparecer de novo na próxima partida.
  }
}

const CLOSABLE: ReadonlySet<TutorialStepId> = new Set(['income', 'nexus', 'positions']);

function textOf(id: TutorialStepId): string {
  return config.steps.find((s) => s.id === id)?.text ?? '';
}

export class TutorialModel {
  private readonly done = new Set<TutorialStepId>();
  private shownAt: number | null = null;
  private current: TutorialStepId | null = null;
  private finished: boolean;
  private readonly storage: TutorialStorage | null;

  constructor(storage: TutorialStorage | null) {
    this.storage = storage;
    this.finished = tutorialSeen(storage);
  }

  /** Acabou (visto antes, pulado ou todos os passos feitos). */
  get over(): boolean {
    return this.finished;
  }

  /** Chame a cada quadro: o cartão a mostrar agora (`null` = nenhum). */
  update(state: Readonly<TutorialState>, nowMs: number): TutorialCard | null {
    if (this.finished) return null;
    const called = state.wave > 0 || state.waves.active.length > 0;
    // Os de ação terminam quando a ação acontece, mesmo sem ter aparecido.
    if (state.towers.length > 0) this.done.add('buy');
    if (called) this.done.add('call');
    if (
      this.current !== null &&
      CLOSABLE.has(this.current) &&
      this.shownAt !== null &&
      nowMs - this.shownAt >= config.autoCloseMs
    ) {
      this.done.add(this.current);
    }
    const ready: Record<TutorialStepId, boolean> = {
      buy: true,
      call: this.done.has('buy'),
      income: state.wave >= 1,
      nexus: called && state.towers.length >= currentTowerLimit(state),
      positions: called && state.towers.length >= 2,
    };
    const next =
      (config.steps.map((s) => s.id) as TutorialStepId[]).find(
        (id) => !this.done.has(id) && ready[id],
      ) ?? null;
    if (next !== this.current) {
      this.current = next;
      this.shownAt = next === null ? null : nowMs;
    }
    if (config.steps.every((s) => this.done.has(s.id as TutorialStepId))) this.finish();
    return next === null ? null : { id: next, text: textOf(next), closable: CLOSABLE.has(next) };
  }

  /** Clique no cartão: fecha o passo atual, se ele fecha com clique. */
  close(): void {
    if (this.current !== null && CLOSABLE.has(this.current)) this.done.add(this.current);
  }

  /** "Pular tutorial". */
  skip(): void {
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.current = null;
    markTutorialSeen(this.storage);
  }
}
