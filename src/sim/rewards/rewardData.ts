/**
 * Recompensas de escolha (T24), lidas de `src/data/rewards.json`: em que
 * ondas a tela aparece, quantas cartas, o tempo para escolher, o custo do
 * reroll das cartas e a lista de bônus.
 *
 * Cada bônus tem um efeito (`effect.kind`) com os números dele. Os efeitos
 * de classe (`areaDamagePercent`, `triggerCountMinus`, `eliteKillWeight`)
 * valem para as torres da classe da carta (`classId`). O coringa não tem
 * classe nos dados: ela é sorteada quando a carta aparece.
 */

import rewardsJson from '../../data/rewards.json';
import { classData, type ClassData } from '../classes/classData';

export type RewardCategory = 'class' | 'economy' | 'nexus' | 'chain';

export type RewardEffect =
  /** Classe da carta: +N% de dano da área (tiro em área e explosões). */
  | { readonly kind: 'areaDamagePercent'; readonly percent: number }
  /** Classe da carta: contagens "a cada N" −amount, depois do bônus de classe. */
  | { readonly kind: 'triggerCountMinus'; readonly amount: number }
  /** Todas as torres: trava de ativação, em segundos. */
  | { readonly kind: 'activationCooldownSeconds'; readonly seconds: number }
  /** Classe da carta: morte de elite ou chefão vale ×multiplier nos contadores e cargas. */
  | { readonly kind: 'eliteKillWeight'; readonly multiplier: number }
  /** Classe sorteada na carta: conta +count torres para o bônus de classe. */
  | { readonly kind: 'classWildcard'; readonly count: number }
  /** Teto dos juros. */
  | { readonly kind: 'interestCap'; readonly cap: number }
  /** Renda a mais em cada onda fechada. */
  | { readonly kind: 'incomePerWave'; readonly gold: number }
  /** Rerolls grátis em cada loja. */
  | { readonly kind: 'freeRerollsPerShop'; readonly count: number }
  /** Desconto no preço das torres, em %. */
  | { readonly kind: 'towerDiscountPercent'; readonly percent: number }
  /** Devolução da venda, em % do investido. */
  | { readonly kind: 'sellRefundPercent'; readonly percent: number }
  /** Limite de torres a mais. */
  | { readonly kind: 'towerLimit'; readonly amount: number }
  /** Vida máxima a mais (e cura total ao escolher). */
  | { readonly kind: 'nexusMaxHp'; readonly amount: number }
  /** Multiplicador do dano do ataque do núcleo. */
  | { readonly kind: 'nexusDamageMultiplier'; readonly multiplier: number }
  /** A loja sorteia a raridade como se o núcleo estivesse `levels` níveis acima. */
  | { readonly kind: 'shopRarityLevels'; readonly levels: number }
  /** A cada `every` gatilhos visíveis de uma cadeia, +gold de ouro. */
  | { readonly kind: 'chainGold'; readonly every: number; readonly gold: number };

export type RewardEffectKind = RewardEffect['kind'];

export interface RewardDef {
  readonly id: string;
  readonly name: string;
  /** Frase da carta. No coringa, `{classe}` vira o nome da classe sorteada. */
  readonly text: string;
  readonly category: RewardCategory;
  /** Classe da carta (cor e alvo dos efeitos de classe); `null` = sem classe fixa. */
  readonly classId: string | null;
  /** Pode sair de novo depois de escolhido. */
  readonly repeatable: boolean;
  readonly effect: RewardEffect;
}

export interface RewardData {
  /** Ondas que dão a tela ao fechar, em ordem. */
  readonly waves: readonly number[];
  /** Cartas por tela. */
  readonly choices: number;
  /** Tempo para escolher; depois disso a simulação escolhe pelo RNG. */
  readonly chooseSeconds: number;
  /** Reroll das cartas: `baseCost` + `costStep` × rerolls já feitos na tela. */
  readonly reroll: { readonly baseCost: number; readonly costStep: number };
  /** Na ordem do arquivo. */
  readonly rewards: readonly RewardDef[];
  readonly byId: ReadonlyMap<string, RewardDef>;
}

/** Parâmetros numéricos de cada efeito: inteiro ≥ 1 (`int`) ou número > 0 (`positive`). */
const EFFECT_PARAMS: Record<RewardEffectKind, Record<string, 'int' | 'positive'>> = {
  areaDamagePercent: { percent: 'positive' },
  triggerCountMinus: { amount: 'int' },
  activationCooldownSeconds: { seconds: 'positive' },
  eliteKillWeight: { multiplier: 'positive' },
  classWildcard: { count: 'int' },
  interestCap: { cap: 'int' },
  incomePerWave: { gold: 'int' },
  freeRerollsPerShop: { count: 'int' },
  towerDiscountPercent: { percent: 'positive' },
  sellRefundPercent: { percent: 'positive' },
  towerLimit: { amount: 'int' },
  nexusMaxHp: { amount: 'int' },
  nexusDamageMultiplier: { multiplier: 'positive' },
  shopRarityLevels: { levels: 'int' },
  chainGold: { every: 'int', gold: 'int' },
};

/** Efeitos que valem só para as torres da classe da carta (precisam de `classId`). */
const CLASS_SCOPED: ReadonlySet<RewardEffectKind> = new Set([
  'areaDamagePercent',
  'triggerCountMinus',
  'eliteKillWeight',
]);

const CATEGORIES: readonly RewardCategory[] = ['class', 'economy', 'nexus', 'chain'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min;
}

function fail(message: string): never {
  throw new Error(`Dados de recompensas inválidos: ${message}`);
}

function parseEffect(where: string, raw: unknown): RewardEffect {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !Object.hasOwn(EFFECT_PARAMS, raw.kind)) {
    fail(`${where}: "effect.kind" desconhecido`);
  }
  const params = EFFECT_PARAMS[raw.kind as RewardEffectKind];
  const extra = Object.keys(raw).filter((k) => k !== 'kind' && !Object.hasOwn(params, k));
  if (extra.length > 0) fail(`${where}: campos desconhecidos no efeito: ${extra.join(', ')}`);
  for (const [name, rule] of Object.entries(params)) {
    const value = raw[name];
    const ok =
      rule === 'int'
        ? isInt(value, 1)
        : typeof value === 'number' && Number.isFinite(value) && value > 0;
    if (!ok) fail(`${where}: "${name}" precisa ser ${rule === 'int' ? 'inteiro ≥ 1' : '> 0'}`);
  }
  if (raw.kind === 'towerDiscountPercent' && (raw.percent as number) >= 100) {
    fail(`${where}: o desconto precisa ser menor que 100%`);
  }
  return raw as unknown as RewardEffect;
}

function parseReward(id: string, raw: unknown, classes: ClassData): RewardDef {
  const where = `"${id}"`;
  if (!isRecord(raw)) fail(`${where} não é um objeto`);
  const { name, text, category, repeatable } = raw;
  if (typeof name !== 'string' || name === '') fail(`${where} precisa de "name"`);
  if (typeof text !== 'string' || text === '') fail(`${where} precisa de "text"`);
  if (!CATEGORIES.includes(category as RewardCategory)) {
    fail(`${where}: "category" precisa ser ${CATEGORIES.join(', ')}`);
  }
  if (typeof repeatable !== 'boolean')
    fail(`${where}: "repeatable" precisa ser verdadeiro ou falso`);
  const classId = Object.hasOwn(raw, 'classId') ? raw.classId : null;
  if (classId !== null && (typeof classId !== 'string' || !classes.ids.includes(classId))) {
    fail(`${where}: "classId" não é uma classe dos dados`);
  }
  const effect = parseEffect(where, raw.effect);
  if (CLASS_SCOPED.has(effect.kind) && classId === null) {
    fail(`${where}: o efeito "${effect.kind}" precisa de "classId"`);
  }
  if (effect.kind === 'classWildcard' && (classId !== null || category !== 'class')) {
    fail(`${where}: o coringa é da categoria "class" e não tem "classId" (a classe é sorteada)`);
  }
  return {
    id,
    name,
    text,
    category: category as RewardCategory,
    classId: classId as string | null,
    repeatable,
    effect,
  };
}

export function loadRewardData(raw: unknown, classes: ClassData = classData): RewardData {
  if (!isRecord(raw)) fail('não é um objeto');
  const { waves, choices, chooseSeconds, reroll, rewards } = raw;
  if (!Array.isArray(waves) || !waves.every((w) => isInt(w, 1))) {
    fail('"waves" precisa ser uma lista de ondas (inteiros ≥ 1)');
  }
  for (let i = 1; i < waves.length; i++) {
    if ((waves[i] as number) <= (waves[i - 1] as number)) fail('"waves" fora de ordem');
  }
  if (!isInt(choices, 1)) fail('"choices" precisa ser inteiro ≥ 1');
  if (typeof chooseSeconds !== 'number' || !Number.isFinite(chooseSeconds) || chooseSeconds <= 0) {
    fail('"chooseSeconds" precisa ser > 0');
  }
  if (!isRecord(reroll) || !isInt(reroll.baseCost, 0) || !isInt(reroll.costStep, 0)) {
    fail('"reroll" precisa de baseCost e costStep inteiros ≥ 0');
  }
  if (!isRecord(rewards) || Object.keys(rewards).length === 0) {
    fail('"rewards" precisa ter pelo menos um bônus');
  }
  const list = Object.entries(rewards).map(([id, entry]) => parseReward(id, entry, classes));
  return {
    waves: waves as number[],
    choices,
    chooseSeconds,
    reroll: { baseCost: reroll.baseCost, costStep: reroll.costStep },
    rewards: list,
    byId: new Map(list.map((r) => [r.id, r])),
  };
}

export const rewardData: RewardData = loadRewardData(rewardsJson);

/** Bônus pelo id (erro se não existir). */
export function getReward(data: RewardData, id: string): RewardDef {
  const reward = data.byId.get(id);
  if (!reward) throw new Error(`Recompensa desconhecida: "${id}"`);
  return reward;
}
