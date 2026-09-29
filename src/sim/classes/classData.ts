/**
 * Classes das torres, lidas de `src/data/classes.json`. Por enquanto só o id e
 * o nome, para validar as classes de cada torre; os bônus entram na T08.
 */

import classesJson from '../../data/classes.json';

export interface TowerClass {
  readonly name: string;
}

export type ClassData = Readonly<Record<string, TowerClass>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadClassData(raw: unknown): ClassData {
  if (!isRecord(raw)) {
    throw new Error('Dados de classes inválidos: não é um objeto');
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    throw new Error('Dados de classes inválidos: nenhuma classe definida');
  }
  const classes: Record<string, TowerClass> = {};
  for (const [id, entry] of entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name === '') {
      throw new Error(`Classe inválida: "${id}" precisa de um nome`);
    }
    classes[id] = { name: entry.name };
  }
  return classes;
}

export const classData: ClassData = loadClassData(classesJson);
