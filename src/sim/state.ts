/**
 * Estado completo da run. Tudo aqui precisa caber em JSON: é a base do save
 * no meio da run. As próximas tarefas acrescentam grade, torres, inimigos etc.
 */

import { hashSeed } from './engine/rng';

export const RUN_STATE_VERSION = 1;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Ação do jogador, aplicada no início do próximo tick. */
export interface SimCommand {
  type: string;
  payload?: JsonValue;
}

export interface RunState {
  version: number;
  seed: string;
  tick: number;
  rngState: number;
  nextEntityId: number;
  /** Ações enfileiradas que ainda não foram aplicadas. */
  commandQueue: SimCommand[];
}

export function createRunState(seed: string): RunState {
  return {
    version: RUN_STATE_VERSION,
    seed,
    tick: 0,
    rngState: hashSeed(seed),
    nextEntityId: 1,
    commandQueue: [],
  };
}

export function serializeRunState(state: RunState): string {
  return JSON.stringify(state);
}

export function deserializeRunState(json: string): RunState {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null) {
    throw new Error('Save inválido: não é um objeto');
  }
  const state = data as Partial<RunState>;
  if (state.version !== RUN_STATE_VERSION) {
    throw new Error(`Versão de save não suportada: ${String(state.version)}`);
  }
  if (
    typeof state.seed !== 'string' ||
    !Number.isInteger(state.tick) ||
    !Number.isInteger(state.rngState) ||
    !Number.isInteger(state.nextEntityId) ||
    !Array.isArray(state.commandQueue)
  ) {
    throw new Error('Save inválido: campos ausentes ou com tipo errado');
  }
  return state as RunState;
}
