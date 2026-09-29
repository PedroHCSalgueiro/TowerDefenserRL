/**
 * Formato dos gatilhos em dados (`trigger` de cada torre em `towers.json`) e
 * as regras de segurança do motor (bloco `triggers` do mesmo arquivo).
 *
 * Um gatilho é **quando** (`when`) + **o quê** (`do`) + **parâmetros por
 * estrela** (`stars`, índice 0 = ★1). Cada entrada de `stars` traz, num objeto
 * só, os parâmetros do "quando" e os do "o quê"; os nomes nunca se repetem
 * entre os dois. O carregador expande isso em objetos tipados por estrela.
 *
 * Para criar um "quando" ou um "o quê" novo: uma linha nas tabelas abaixo,
 * mais o tipo na união e o código no motor (`facts.ts` ou `effects.ts`).
 * Torre nova com gatilho existente é só dado.
 */

/** Estrelas possíveis (Mini-GDD, Sistema 4): de ★1 a ★5. */
const MAX_STARS = 5;

interface ParamSpec {
  readonly name: string;
  /** Contagem: inteiro ≥ 1. Sem isso: número > 0. */
  readonly integer: boolean;
  /** Teto inclusivo (porcentagens de vida). */
  readonly max?: number;
}

const count = (name: string): ParamSpec => ({ name, integer: true });
const positive = (name: string, max?: number): ParamSpec => ({ name, integer: false, max });

/** Parâmetros de cada "quando". */
const WHEN_PARAMS = {
  /** Completa N tiros (normais ou de ativação). */
  everyNShots: [count('shots')],
  /** Um inimigo morre dentro do alcance (qualquer autor). */
  enemyDiesInRange: [],
  /** A torre dispara (tiro normal ou de ativação). */
  onFire: [],
  /** A torre é ativada por uma vizinha. */
  onActivated: [],
  /** Uma vizinha abate (abate duplo conta 2). */
  neighborKills: [],
  /** Completa N abates dentro do alcance (qualquer autor; abate duplo conta 2). */
  everyNKillsInRange: [count('kills')],
} as const satisfies Record<string, readonly ParamSpec[]>;

/** Parâmetros de cada "o quê". Porcentagens de dano são do dano base da torre. */
const DO_PARAMS = {
  multiShot: [count('extraShots')],
  explosion: [positive('radius'), positive('damagePercent')],
  activateNeighbors: [count('maxTargets')],
  chargeLightning: [
    count('charges'),
    count('targets'),
    positive('jumpRadius'),
    positive('damagePercent'),
  ],
  pierceLine: [positive('halfWidth'), positive('damagePercent')],
  execute: [positive('hpPercent', 100), count('killWeight')],
  copyLast: [],
} as const satisfies Record<string, readonly ParamSpec[]>;

export type WhenKind = keyof typeof WHEN_PARAMS;
export type EffectKind = keyof typeof DO_PARAMS;

export const WHEN_KINDS = Object.keys(WHEN_PARAMS) as WhenKind[];
export const EFFECT_KINDS = Object.keys(DO_PARAMS) as EffectKind[];

export type TriggerWhen =
  | { readonly kind: 'everyNShots'; readonly shots: number }
  | { readonly kind: 'enemyDiesInRange' }
  | { readonly kind: 'onFire' }
  | { readonly kind: 'onActivated' }
  | { readonly kind: 'neighborKills' }
  | { readonly kind: 'everyNKillsInRange'; readonly kills: number };

export type TriggerEffect =
  | { readonly kind: 'multiShot'; readonly extraShots: number }
  | { readonly kind: 'explosion'; readonly radius: number; readonly damagePercent: number }
  | { readonly kind: 'activateNeighbors'; readonly maxTargets: number }
  | {
      readonly kind: 'chargeLightning';
      readonly charges: number;
      readonly targets: number;
      readonly jumpRadius: number;
      readonly damagePercent: number;
    }
  | { readonly kind: 'pierceLine'; readonly halfWidth: number; readonly damagePercent: number }
  | { readonly kind: 'execute'; readonly hpPercent: number; readonly killWeight: number }
  | { readonly kind: 'copyLast' };

/** Um "o quê" que pode ser guardado e copiado (tudo, menos o próprio "copiar"). */
export type CopyableEffect = Exclude<TriggerEffect, { kind: 'copyLast' }>;

/** O gatilho numa estrela: "quando" e "o quê" já com os números. */
export interface TriggerStar {
  readonly when: TriggerWhen;
  readonly effect: TriggerEffect;
}

export interface TriggerDef {
  /** Índice 0 = ★1. De 1 a 5 entradas. */
  readonly stars: readonly TriggerStar[];
}

export type Neighborhood = 4 | 8;

/** Regras de segurança do motor, iguais para todas as torres. */
export interface TriggerRules {
  /** Vizinhas de uma torre: 4 (lados) ou 8 (com diagonais). */
  readonly neighborhood: Neighborhood;
  /** Cada torre só pode ser ativada por gatilho uma vez a cada tantos segundos. */
  readonly activationCooldownSeconds: number;
  /** Profundidade de cadeia processada por tick; o resto continua no tick seguinte. */
  readonly maxChainDepthPerTick: number;
  /** Entradas da fila processadas por tick; o resto continua no tick seguinte. */
  readonly maxActivationsPerTick: number;
  /** Teto da fila: entradas novas acima dele são descartadas (e contadas). */
  readonly maxQueueSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function validParam(spec: ParamSpec, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  if (spec.integer && !Number.isInteger(value)) return false;
  return spec.max === undefined || value <= spec.max;
}

function isKind<K extends string>(table: Record<K, unknown>, value: unknown): value is K {
  return typeof value === 'string' && Object.hasOwn(table, value);
}

/** Lê os parâmetros de `specs` de uma entrada de estrela, em `{ kind, ...params }`. */
function pick(
  where: string,
  kind: string,
  specs: readonly ParamSpec[],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { kind };
  for (const spec of specs) {
    const value = raw[spec.name];
    if (!validParam(spec, value)) {
      const rule = spec.integer ? 'inteiro ≥ 1' : spec.max ? `> 0 e ≤ ${spec.max}` : '> 0';
      throw new Error(`${where}: "${spec.name}" precisa ser ${rule} (${String(value)})`);
    }
    out[spec.name] = value;
  }
  return out;
}

/** Valida o `trigger` de uma torre. `null` = torre sem gatilho. */
export function parseTrigger(towerId: string, raw: unknown): TriggerDef | null {
  if (raw === null) return null;
  const where = `Gatilho inválido na torre "${towerId}"`;
  if (!isRecord(raw)) throw new Error(`${where}: não é um objeto`);
  const { when, do: effect, stars } = raw;
  if (!isKind(WHEN_PARAMS, when)) {
    throw new Error(`${where}: "when" desconhecido (${String(when)})`);
  }
  if (!isKind(DO_PARAMS, effect)) {
    throw new Error(`${where}: "do" desconhecido (${String(effect)})`);
  }
  if (!Array.isArray(stars) || stars.length < 1 || stars.length > MAX_STARS) {
    throw new Error(`${where}: "stars" precisa ter de 1 a ${MAX_STARS} entradas`);
  }
  const whenSpecs: readonly ParamSpec[] = WHEN_PARAMS[when];
  const doSpecs: readonly ParamSpec[] = DO_PARAMS[effect];
  const allowed = new Set([...whenSpecs, ...doSpecs].map((s) => s.name));
  const parsed = stars.map((entry: unknown, i): TriggerStar => {
    const at = `${where}, ★${i + 1}`;
    if (!isRecord(entry)) throw new Error(`${at}: não é um objeto`);
    const extra = Object.keys(entry).filter((k) => !allowed.has(k));
    if (extra.length > 0) {
      throw new Error(
        `${at}: parâmetros que "${when}" e "${effect}" não usam: ${extra.join(', ')}`,
      );
    }
    return {
      when: pick(at, when, whenSpecs, entry) as TriggerWhen,
      effect: pick(at, effect, doSpecs, entry) as TriggerEffect,
    };
  });
  return { stars: parsed };
}

/** Gatilho na estrela pedida (as estrelas chegam na T11; até lá, sempre ★1). */
export function triggerAt(def: TriggerDef, stars = 1): TriggerStar {
  const star = def.stars[stars - 1];
  if (!star) throw new Error(`Gatilho sem parâmetros para ★${stars}`);
  return star;
}

/** Valida o bloco `triggers` de `towers.json`. */
export function parseTriggerRules(raw: unknown): TriggerRules {
  if (!isRecord(raw)) {
    throw new Error('Dados de torres inválidos: falta o bloco "triggers"');
  }
  const {
    neighborhood,
    activationCooldownSeconds,
    maxChainDepthPerTick,
    maxActivationsPerTick,
    maxQueueSize,
  } = raw;
  if (neighborhood !== 4 && neighborhood !== 8) {
    throw new Error('Regras de gatilho inválidas: "neighborhood" precisa ser 4 ou 8');
  }
  if (
    typeof activationCooldownSeconds !== 'number' ||
    !Number.isFinite(activationCooldownSeconds) ||
    activationCooldownSeconds <= 0
  ) {
    throw new Error('Regras de gatilho inválidas: "activationCooldownSeconds" precisa ser > 0');
  }
  for (const [name, value] of Object.entries({
    maxChainDepthPerTick,
    maxActivationsPerTick,
    maxQueueSize,
  })) {
    if (!isPositiveInteger(value)) {
      throw new Error(`Regras de gatilho inválidas: "${name}" precisa ser inteiro ≥ 1`);
    }
  }
  return {
    neighborhood,
    activationCooldownSeconds,
    maxChainDepthPerTick: maxChainDepthPerTick as number,
    maxActivationsPerTick: maxActivationsPerTick as number,
    maxQueueSize: maxQueueSize as number,
  };
}
