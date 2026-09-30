/**
 * Tipos de torre, lidos de `src/data/towers.json`.
 *
 * Alcance e raio são em casas, medidos do centro da casa da torre (ou do
 * ponto de impacto) até a posição do inimigo. `projectileSpeed` é em casas
 * por segundo. `trigger` é o gatilho da torre (`null` = sem gatilho), no
 * formato de `src/sim/triggers/triggerData.ts`; o bloco `triggers` traz as
 * regras de segurança do motor.
 */

import towersJson from '../../data/towers.json';
import { classData, type ClassData } from '../classes/classData';
import {
  parseTrigger,
  parseTriggerRules,
  type TriggerDef,
  type TriggerRules,
} from '../triggers/triggerData';
import { isTargetMode, type TargetMode } from './targeting';

/** Tiro único (só o alvo) ou em área (todos no raio do ponto de impacto). */
export type ShotData =
  { readonly kind: 'single' } | { readonly kind: 'area'; readonly radius: number };

/** Raridade para a loja (T10). Torres de teste não têm (`null`). */
export const RARITIES = ['common', 'uncommon', 'rare'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface TowerType {
  readonly name: string;
  /** `null` = torre de teste: fora da loja e da contagem de classes. */
  readonly rarity: Rarity | null;
  /**
   * Duas classes diferentes, a primeira é a principal (cor no greybox); ou
   * nenhuma, nas torres de teste.
   */
  readonly classes: readonly string[];
  /** `false` = não atira (o Espelho): `damage` e `range` só servem aos efeitos copiados. */
  readonly attacks: boolean;
  readonly damage: number;
  /** 0 se a torre não atira. */
  readonly shotsPerSecond: number;
  readonly range: number;
  readonly projectileSpeed: number;
  readonly shot: ShotData;
  readonly targetMode: TargetMode;
  readonly trigger: TriggerDef | null;
}

export interface TowerData {
  /** Raio, em casas, em que o projétil procura um alvo novo quando o dele some. */
  readonly projectileRetargetRadius: number;
  readonly triggers: TriggerRules;
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
  // Torre de teste (Básica, Canhão): sem classe.
  if (Array.isArray(raw) && raw.length === 0) return [];
  if (
    !Array.isArray(raw) ||
    raw.length !== CLASSES_PER_TOWER ||
    new Set(raw).size !== raw.length ||
    !raw.every((c) => typeof c === 'string' && Object.hasOwn(classes.classes, c))
  ) {
    throw new Error(
      `Torre inválida: "${id}" precisa de ${CLASSES_PER_TOWER} classes diferentes e existentes (ou nenhuma, se for torre de teste)`,
    );
  }
  return raw as string[];
}

function parseType(id: string, raw: unknown, classes: ClassData): TowerType {
  if (!isRecord(raw)) {
    throw new Error(`Torre inválida: "${id}" não é um objeto`);
  }
  const { name, damage, range, targetMode } = raw;
  const attacks = Object.hasOwn(raw, 'attacks') ? raw.attacks : true;
  if (typeof attacks !== 'boolean') {
    throw new Error(`Torre inválida: "${id}" tem "attacks" que não é verdadeiro ou falso`);
  }
  // Sem ataque não há cadência; a velocidade do projétil continua valendo para os efeitos copiados.
  const shotsPerSecond = attacks ? raw.shotsPerSecond : 0;
  const { projectileSpeed } = raw;
  if (
    typeof name !== 'string' ||
    name === '' ||
    !isPositive(damage) ||
    !isPositive(range) ||
    !isPositive(projectileSpeed) ||
    (attacks && !isPositive(shotsPerSecond))
  ) {
    throw new Error(`Torre inválida: "${id}" tem campos ausentes ou não positivos`);
  }
  if (typeof shotsPerSecond !== 'number' || typeof projectileSpeed !== 'number') {
    throw new Error(`Torre inválida: "${id}" tem campos ausentes ou não positivos`);
  }
  if (!isTargetMode(targetMode)) {
    throw new Error(
      `Torre inválida: "${id}" tem modo de mira desconhecido (${String(targetMode)})`,
    );
  }
  if (!Object.hasOwn(raw, 'trigger')) {
    throw new Error(`Torre inválida: "${id}" não tem "trigger" (use null para torre sem gatilho)`);
  }
  const towerClasses = parseClasses(id, raw.classes, classes);
  const rarity = raw.rarity;
  if (towerClasses.length === 0 ? rarity !== null : !RARITIES.includes(rarity as Rarity)) {
    throw new Error(
      `Torre inválida: "${id}" precisa de raridade (${RARITIES.join(', ')}); torre de teste, sem classes, usa null`,
    );
  }
  return {
    name,
    rarity: rarity as Rarity | null,
    classes: towerClasses,
    attacks,
    damage,
    shotsPerSecond,
    range,
    projectileSpeed,
    shot: parseShot(id, raw.shot),
    targetMode,
    trigger: parseTrigger(id, raw.trigger),
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
  return {
    projectileRetargetRadius: raw.projectileRetargetRadius,
    triggers: parseTriggerRules(raw.triggers),
    types,
  };
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
