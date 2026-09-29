/**
 * Tipos de torre, lidos de `src/data/towers.json`.
 *
 * Alcance e raio são em casas, medidos do centro da casa da torre (ou do
 * ponto de impacto) até a posição do inimigo. `projectileSpeed` é em casas
 * por segundo. `trigger` fica `null` até o motor de gatilhos (T07).
 */

import towersJson from '../../data/towers.json';
import { classData, type ClassData } from '../classes/classData';
import { isTargetMode, type TargetMode } from './targeting';

/** Tiro único (só o alvo) ou em área (todos no raio do ponto de impacto). */
export type ShotData =
  { readonly kind: 'single' } | { readonly kind: 'area'; readonly radius: number };

export interface TowerType {
  readonly name: string;
  /** Duas classes diferentes; a primeira é a principal (cor no greybox). */
  readonly classes: readonly string[];
  readonly damage: number;
  readonly shotsPerSecond: number;
  readonly range: number;
  readonly projectileSpeed: number;
  readonly shot: ShotData;
  readonly targetMode: TargetMode;
  readonly trigger: null;
}

export interface TowerData {
  /** Raio, em casas, em que o projétil procura um alvo novo quando o dele some. */
  readonly projectileRetargetRadius: number;
  readonly types: Readonly<Record<string, TowerType>>;
}

/** Cada torre tem exatamente 2 classes (Mini-GDD, Sistema 1). */
const CLASSES_PER_TOWER = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseShot(id: string, raw: unknown): ShotData {
  if (isRecord(raw) && raw.kind === 'single') return { kind: 'single' };
  if (isRecord(raw) && raw.kind === 'area' && isPositive(raw.radius)) {
    return { kind: 'area', radius: raw.radius };
  }
  throw new Error(`Torre inválida: "${id}" tem "shot" inválido (single, ou area com radius > 0)`);
}

function parseClasses(id: string, raw: unknown, classes: ClassData): string[] {
  if (
    !Array.isArray(raw) ||
    raw.length !== CLASSES_PER_TOWER ||
    new Set(raw).size !== raw.length ||
    !raw.every((c) => typeof c === 'string' && Object.hasOwn(classes, c))
  ) {
    throw new Error(
      `Torre inválida: "${id}" precisa de ${CLASSES_PER_TOWER} classes diferentes e existentes`,
    );
  }
  return raw as string[];
}

function parseType(id: string, raw: unknown, classes: ClassData): TowerType {
  if (!isRecord(raw)) {
    throw new Error(`Torre inválida: "${id}" não é um objeto`);
  }
  const { name, damage, shotsPerSecond, range, projectileSpeed, targetMode, trigger } = raw;
  if (
    typeof name !== 'string' ||
    name === '' ||
    !isPositive(damage) ||
    !isPositive(shotsPerSecond) ||
    !isPositive(range) ||
    !isPositive(projectileSpeed)
  ) {
    throw new Error(`Torre inválida: "${id}" tem campos ausentes ou não positivos`);
  }
  if (!isTargetMode(targetMode)) {
    throw new Error(
      `Torre inválida: "${id}" tem modo de mira desconhecido (${String(targetMode)})`,
    );
  }
  if (trigger !== null) {
    throw new Error(
      `Torre inválida: "${id}" tem gatilho, mas o motor de gatilhos ainda não existe`,
    );
  }
  return {
    name,
    classes: parseClasses(id, raw.classes, classes),
    damage,
    shotsPerSecond,
    range,
    projectileSpeed,
    shot: parseShot(id, raw.shot),
    targetMode,
    trigger: null,
  };
}

/** Valida os dados das torres. Erro claro em vez de NaN no meio da run. */
export function loadTowerData(raw: unknown, classes: ClassData = classData): TowerData {
  if (!isRecord(raw) || !isRecord(raw.types)) {
    throw new Error('Dados de torres inválidos: falta "types"');
  }
  if (!isPositive(raw.projectileRetargetRadius)) {
    throw new Error('Dados de torres inválidos: "projectileRetargetRadius" precisa ser positivo');
  }
  const entries = Object.entries(raw.types);
  if (entries.length === 0) {
    throw new Error('Dados de torres inválidos: nenhum tipo definido');
  }
  const types: Record<string, TowerType> = {};
  for (const [id, type] of entries) {
    types[id] = parseType(id, type, classes);
  }
  return { projectileRetargetRadius: raw.projectileRetargetRadius, types };
}

export const towerData: TowerData = loadTowerData(towersJson);

/** O tipo existe (ignora herdados, como `toString`)? */
export function hasTowerType(data: TowerData, id: string): boolean {
  return Object.hasOwn(data.types, id);
}

/** Tipo pelo id, com erro para id desconhecido. */
export function getTowerType(data: TowerData, id: string): TowerType {
  const type = hasTowerType(data, id) ? data.types[id] : undefined;
  if (!type) {
    throw new Error(`Tipo de torre desconhecido: "${id}"`);
  }
  return type;
}
