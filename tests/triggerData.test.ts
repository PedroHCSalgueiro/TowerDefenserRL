import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import towersJson from '../src/data/towers.json';
import { hasTowerType, loadTowerData, towerData } from '../src/sim/towers/towerData';
import {
  EFFECT_KINDS,
  WHEN_KINDS,
  parseTrigger,
  parseTriggerRules,
  triggerAt,
} from '../src/sim/triggers/triggerData';

type RawTowers = {
  triggers: Record<string, unknown>;
  types: Record<string, Record<string, unknown>>;
};

function rawTowers(): RawTowers {
  return JSON.parse(JSON.stringify(towersJson)) as RawTowers;
}

describe('gatilhos em dados (towers.json)', () => {
  it('regras de segurança do protótipo', () => {
    expect(towerData.triggers).toEqual({
      neighborhood: 4,
      activationCooldownSeconds: 1,
      maxChainDepthPerTick: 8,
      maxActivationsPerTick: 2000,
      maxQueueSize: 10000,
    });
  });

  it('as 4 torres provisórias do Mini-GDD, com os números aprovados', () => {
    const t = towerData.types;
    expect(t.mortar).toMatchObject({
      name: 'Morteiro',
      classes: ['artillery', 'mechanical'],
      damage: 8,
      shotsPerSecond: 0.8,
      range: 3,
      projectileSpeed: 5,
      shot: { kind: 'area', radius: 1 },
    });
    expect(t.reaper).toMatchObject({
      name: 'Ceifador',
      classes: ['shadow', 'artillery'],
      damage: 6,
      shotsPerSecond: 1,
      range: 2.5,
      projectileSpeed: 8,
      shot: { kind: 'single' },
    });
    expect(t.relay).toMatchObject({
      name: 'Relé',
      classes: ['arcane', 'mechanical'],
      damage: 5,
      shotsPerSecond: 1.5,
      range: 3,
      projectileSpeed: 8,
      shot: { kind: 'single' },
    });
    expect(t.obelisk).toMatchObject({
      name: 'Obelisco',
      classes: ['arcane', 'shadow'],
      damage: 10,
      shotsPerSecond: 0.5,
      range: 3.5,
      projectileSpeed: 8,
      shot: { kind: 'single' },
    });
    expect(triggerAt(t.mortar!.trigger!)).toEqual({
      when: { kind: 'everyNShots', shots: 5 },
      effect: { kind: 'multiShot', extraShots: 2 },
    });
    expect(triggerAt(t.reaper!.trigger!)).toEqual({
      when: { kind: 'enemyDiesInRange' },
      effect: { kind: 'explosion', radius: 1, damagePercent: 100 },
    });
    expect(triggerAt(t.relay!.trigger!)).toEqual({
      when: { kind: 'onFire' },
      effect: { kind: 'activateNeighbors', maxTargets: 4 },
    });
    expect(triggerAt(t.obelisk!.trigger!)).toEqual({
      when: { kind: 'neighborKills' },
      effect: {
        kind: 'chargeLightning',
        charges: 3,
        targets: 4,
        jumpRadius: 2,
        damagePercent: 100,
      },
    });
  });

  it('o cenário de cadeia do debug usa tipos que existem e têm gatilho', () => {
    expect(debugConfig.chainScenario.towerTypes).toHaveLength(4);
    for (const id of debugConfig.chainScenario.towerTypes) {
      expect(hasTowerType(towerData, id)).toBe(true);
      expect(towerData.types[id]!.trigger).not.toBeNull();
    }
  });

  it('cada "quando" e cada "o quê" carregam com os seus parâmetros', () => {
    const whenParams: Record<string, Record<string, number>> = {
      everyNShots: { shots: 5 },
      everyNKillsInRange: { kills: 3 },
    };
    const doParams: Record<string, Record<string, number>> = {
      multiShot: { extraShots: 2 },
      explosion: { radius: 1, damagePercent: 50 },
      activateNeighbors: { maxTargets: 4 },
      chargeLightning: { charges: 3, targets: 4, jumpRadius: 2, damagePercent: 100 },
      pierceLine: { halfWidth: 0.5, damagePercent: 80 },
      execute: { hpPercent: 15, killWeight: 2 },
      copyLast: {},
    };
    expect(WHEN_KINDS).toHaveLength(6);
    expect(EFFECT_KINDS).toHaveLength(7);
    for (const when of WHEN_KINDS) {
      for (const effect of EFFECT_KINDS) {
        const w = whenParams[when] ?? {};
        const d = doParams[effect]!;
        const def = parseTrigger('x', { when, do: effect, stars: [{ ...w, ...d }] });
        expect(triggerAt(def!)).toEqual({
          when: { kind: when, ...w },
          effect: { kind: effect, ...d },
        });
      }
    }
    expect(parseTrigger('x', null)).toBeNull();
  });

  it('parâmetros por estrela: de ★1 a ★5, cada uma com os seus números', () => {
    const stars = [1, 2, 3, 4, 5].map((n) => ({ shots: 6 - n, extraShots: n }));
    const def = parseTrigger('x', { when: 'everyNShots', do: 'multiShot', stars })!;
    expect(triggerAt(def, 1).effect).toEqual({ kind: 'multiShot', extraShots: 1 });
    expect(triggerAt(def, 5).when).toEqual({ kind: 'everyNShots', shots: 1 });
    const one = parseTrigger('x', { when: 'onFire', do: 'multiShot', stars: [{ extraShots: 1 }] })!;
    expect(() => triggerAt(one, 2)).toThrow(/★2/);
  });

  const base = { when: 'everyNShots', do: 'multiShot', stars: [{ shots: 5, extraShots: 2 }] };
  it.each<[string, unknown]>([
    ['não é objeto', 3],
    ['"quando" desconhecido', { ...base, when: 'onHit' }],
    ['"quando" herdado', { ...base, when: 'toString' }],
    ['"o quê" desconhecido', { ...base, do: 'freeze' }],
    ['sem estrelas', { ...base, stars: [] }],
    ['6 estrelas', { ...base, stars: Array(6).fill({ shots: 5, extraShots: 2 }) }],
    ['estrela que não é objeto', { ...base, stars: [5] }],
    ['falta parâmetro', { ...base, stars: [{ shots: 5 }] }],
    ['parâmetro sobrando', { ...base, stars: [{ shots: 5, extraShots: 2, radius: 1 }] }],
    ['contagem fracionária', { ...base, stars: [{ shots: 2.5, extraShots: 2 }] }],
    ['contagem zero', { ...base, stars: [{ shots: 0, extraShots: 2 }] }],
    ['número em texto', { ...base, stars: [{ shots: '5', extraShots: 2 }] }],
    [
      'porcentagem de vida acima de 100',
      { when: 'onFire', do: 'execute', stars: [{ hpPercent: 101, killWeight: 2 }] },
    ],
    ['raio zero', { when: 'onFire', do: 'explosion', stars: [{ radius: 0, damagePercent: 50 }] }],
  ])('rejeita gatilho: %s', (_name, raw) => {
    expect(() => parseTrigger('x', raw)).toThrow(/inválido/);
  });

  it.each<[string, (r: RawTowers) => void]>([
    ['sem o bloco triggers', (r) => delete (r as Partial<RawTowers>).triggers],
    ['vizinhança 6', (r) => (r.triggers.neighborhood = 6)],
    ['trava de ativação zero', (r) => (r.triggers.activationCooldownSeconds = 0)],
    ['profundidade fracionária', (r) => (r.triggers.maxChainDepthPerTick = 2.5)],
    ['orçamento zero', (r) => (r.triggers.maxActivationsPerTick = 0)],
    ['teto da fila ausente', (r) => delete r.triggers.maxQueueSize],
    ['gatilho quebrado numa torre', (r) => (r.types.mortar!.trigger = { when: 'onFire' })],
  ])('rejeita dados de torres: %s', (_name, mutate) => {
    const raw = rawTowers();
    mutate(raw);
    expect(() => loadTowerData(raw)).toThrow(/inválid/);
  });

  it('regras: aceita vizinhança 8 (bônus da Arcana, T08)', () => {
    expect(parseTriggerRules({ ...towersJson.triggers, neighborhood: 8 }).neighborhood).toBe(8);
  });
});
