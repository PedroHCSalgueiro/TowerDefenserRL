/**
 * Classes das torres e seus bônus, lidos de `src/data/classes.json`.
 *
 * Cada classe tem uma lista de níveis, do menor para o maior. Um nível vale
 * quando o mapa tem `count` torres diferentes com a classe (ver `bonuses.ts`).
 * Os campos de efeito que um nível não cita ficam neutros (multiplicador 1,
 * redução 0, raio 0), para o código multiplicar sem checar `null`.
 */

import classesJson from '../../data/classes.json';

/** De onde vêm as mortes que o bônus da Sombria dobra. */
export type KillWeightFrom = 'sameClass' | 'any';

export interface ClassLevel {
  /** Torres diferentes com a classe para o nível valer. */
  readonly count: number;
  /** Texto do nível, mostrado na interface. */
  readonly text: string;
  /** Artilharia: multiplica o raio da área do ataque normal e das explosões de gatilho. */
  readonly areaRadiusMultiplier: number;
  /** Artilharia: multiplica o dano da área do ataque normal e das explosões de gatilho. */
  readonly areaDamageMultiplier: number;
  /** Mecânica: reduz, em %, a contagem dos gatilhos "a cada N". */
  readonly triggerCountReductionPercent: number;
  /** Arcana: raio, em casas, da vizinhança quadrada (0 = vizinhança dos dados). */
  readonly neighborhoodRadius: number;
  /** Sombria: multiplica o peso das mortes nos gatilhos das torres da classe. */
  readonly killWeightMultiplier: number;
  /** Sombria: quais mortes o multiplicador atinge. */
  readonly killWeightFrom: KillWeightFrom;
}

export interface TowerClass {
  readonly name: string;
  /** Do menor para o maior `count`. */
  readonly levels: readonly ClassLevel[];
}

export interface ClassData {
  /** Mecânica: a contagem de um "a cada N" nunca cai abaixo disto. */
  readonly minTriggerCount: number;
  /** Teto do peso de uma morte depois do bônus da Sombria. */
  readonly maxKillWeight: number;
  readonly classes: Readonly<Record<string, TowerClass>>;
  /** Ids das classes, na ordem do arquivo. */
  readonly ids: readonly string[];
}

const LEVEL_KEYS = new Set([
  'count',
  'text',
  'areaRadiusMultiplier',
  'areaDamageMultiplier',
  'triggerCountReductionPercent',
  'neighborhoodRadius',
  'killWeightMultiplier',
  'killWeightFrom',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Campo numérico opcional de um nível: usa `neutral` se ausente. */
function optionalNumber(
  where: string,
  raw: Record<string, unknown>,
  key: string,
  neutral: number,
  valid: (value: number) => boolean,
  rule: string,
): number {
  if (!Object.hasOwn(raw, key)) return neutral;
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !valid(value)) {
    throw new Error(`${where}: "${key}" precisa ser ${rule} (${String(value)})`);
  }
  return value;
}

function parseLevel(classId: string, index: number, raw: unknown): ClassLevel {
  const where = `Classe inválida: "${classId}", nível ${index + 1}`;
  if (!isRecord(raw)) throw new Error(`${where}: não é um objeto`);
  const extra = Object.keys(raw).filter((k) => !LEVEL_KEYS.has(k));
  if (extra.length > 0) throw new Error(`${where}: campos desconhecidos: ${extra.join(', ')}`);
  if (!isPositiveInteger(raw.count)) throw new Error(`${where}: "count" precisa ser inteiro ≥ 1`);
  if (typeof raw.text !== 'string' || raw.text === '') {
    throw new Error(`${where}: "text" precisa ser um texto`);
  }
  const from = Object.hasOwn(raw, 'killWeightFrom') ? raw.killWeightFrom : 'sameClass';
  if (from !== 'sameClass' && from !== 'any') {
    throw new Error(`${where}: "killWeightFrom" precisa ser "sameClass" ou "any"`);
  }
  return {
    count: raw.count,
    text: raw.text,
    areaRadiusMultiplier: optionalNumber(
      where,
      raw,
      'areaRadiusMultiplier',
      1,
      (v) => v > 0,
      '> 0',
    ),
    areaDamageMultiplier: optionalNumber(
      where,
      raw,
      'areaDamageMultiplier',
      1,
      (v) => v > 0,
      '> 0',
    ),
    triggerCountReductionPercent: optionalNumber(
      where,
      raw,
      'triggerCountReductionPercent',
      0,
      (v) => v >= 0 && v < 100,
      'de 0 a menos de 100',
    ),
    neighborhoodRadius: optionalNumber(
      where,
      raw,
      'neighborhoodRadius',
      0,
      (v) => Number.isInteger(v) && v >= 1,
      'inteiro ≥ 1',
    ),
    killWeightMultiplier: optionalNumber(
      where,
      raw,
      'killWeightMultiplier',
      1,
      (v) => v >= 1,
      '≥ 1',
    ),
    killWeightFrom: from,
  };
}

function parseClass(id: string, raw: unknown): TowerClass {
  if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name === '') {
    throw new Error(`Classe inválida: "${id}" precisa de um nome`);
  }
  if (!Array.isArray(raw.levels)) {
    throw new Error(`Classe inválida: "${id}" precisa de "levels" (pode ser vazio)`);
  }
  const levels = raw.levels.map((level: unknown, i) => parseLevel(id, i, level));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]!.count <= levels[i - 1]!.count) {
      throw new Error(`Classe inválida: "${id}" tem níveis fora de ordem (count crescente)`);
    }
  }
  return { name: raw.name, levels };
}

export function loadClassData(raw: unknown): ClassData {
  if (!isRecord(raw) || !isRecord(raw.classes)) {
    throw new Error('Dados de classes inválidos: falta "classes"');
  }
  if (!isPositiveInteger(raw.minTriggerCount) || raw.minTriggerCount < 2) {
    throw new Error('Dados de classes inválidos: "minTriggerCount" precisa ser inteiro ≥ 2');
  }
  if (!isPositiveInteger(raw.maxKillWeight) || raw.maxKillWeight < 2) {
    throw new Error('Dados de classes inválidos: "maxKillWeight" precisa ser inteiro ≥ 2');
  }
  const entries = Object.entries(raw.classes);
  if (entries.length === 0) {
    throw new Error('Dados de classes inválidos: nenhuma classe definida');
  }
  const classes: Record<string, TowerClass> = {};
  for (const [id, entry] of entries) classes[id] = parseClass(id, entry);
  return {
    minTriggerCount: raw.minTriggerCount,
    maxKillWeight: raw.maxKillWeight,
    classes,
    ids: entries.map(([id]) => id),
  };
}

export const classData: ClassData = loadClassData(classesJson);
