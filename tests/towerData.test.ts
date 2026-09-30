import { describe, expect, it } from 'vitest';
import towersJson from '../src/data/towers.json';
import { classData, loadClassData } from '../src/sim/classes/classData';
import { getTowerType, hasTowerType, loadTowerData, towerData } from '../src/sim/towers/towerData';

type RawTowers = {
  projectileRetargetRadius: unknown;
  types: Record<string, Record<string, unknown>>;
};

/** Cópia editável do towers.json real. */
function rawTowers(): RawTowers {
  return JSON.parse(JSON.stringify(towersJson)) as RawTowers;
}

describe('dados das classes', () => {
  it('as 4 classes do protótipo carregam com nome e níveis 2 e 4', () => {
    expect(classData.ids).toEqual(['artillery', 'mechanical', 'arcane', 'shadow']);
    expect(classData.ids.map((id) => classData.classes[id]!.name)).toEqual([
      'Artilharia',
      'Mecânica',
      'Arcana',
      'Sombria',
    ]);
    for (const id of classData.ids) {
      expect(classData.classes[id]!.levels.map((l) => l.count)).toEqual([2, 4]);
    }
    expect(classData.minTriggerCount).toBe(2);
    expect(classData.maxKillWeight).toBe(4);
  });

  it('os níveis trazem os números da especificação, neutros onde não citam', () => {
    const [art2, art4] = classData.classes.artillery!.levels;
    expect([art2!.areaRadiusMultiplier, art2!.areaDamageMultiplier]).toEqual([1.25, 1]);
    expect([art4!.areaRadiusMultiplier, art4!.areaDamageMultiplier]).toEqual([1.5, 1.25]);
    expect(classData.classes.mechanical!.levels.map((l) => l.triggerCountReductionPercent)).toEqual(
      [20, 40],
    );
    expect(classData.classes.arcane!.levels.map((l) => l.neighborhoodRadius)).toEqual([1, 2]);
    const [sh2, sh4] = classData.classes.shadow!.levels;
    expect([sh2!.killWeightMultiplier, sh2!.killWeightFrom]).toEqual([2, 'sameClass']);
    expect([sh4!.killWeightMultiplier, sh4!.killWeightFrom]).toEqual([2, 'any']);
    expect(sh2!.neighborhoodRadius).toBe(0);
  });

  const level = { count: 2, text: 'x' };
  const base = { minTriggerCount: 2, maxKillWeight: 4 };
  it.each([
    ['não é objeto', []],
    ['sem classes', base],
    ['classes vazio', { ...base, classes: {} }],
    ['classe sem nome', { ...base, classes: { a: { levels: [] } } }],
    ['nome vazio', { ...base, classes: { a: { name: '', levels: [] } } }],
    ['sem levels', { ...base, classes: { a: { name: 'A' } } }],
    [
      'mínimo de contagem 1',
      { ...base, minTriggerCount: 1, classes: { a: { name: 'A', levels: [] } } },
    ],
    ['teto de peso ausente', { minTriggerCount: 2, classes: { a: { name: 'A', levels: [] } } }],
    ['nível sem texto', { ...base, classes: { a: { name: 'A', levels: [{ count: 2 }] } } }],
    [
      'nível com campo desconhecido',
      { ...base, classes: { a: { name: 'A', levels: [{ ...level, foo: 1 }] } } },
    ],
    [
      'redução de 100%',
      {
        ...base,
        classes: { a: { name: 'A', levels: [{ ...level, triggerCountReductionPercent: 100 }] } },
      },
    ],
    [
      'níveis fora de ordem',
      { ...base, classes: { a: { name: 'A', levels: [{ ...level, count: 4 }, level] } } },
    ],
    [
      'origem de morte desconhecida',
      { ...base, classes: { a: { name: 'A', levels: [{ ...level, killWeightFrom: 'x' }] } } },
    ],
  ])('rejeita dados de classes: %s', (_name, raw) => {
    expect(() => loadClassData(raw)).toThrow(/inválid/);
  });
});

describe('dados das torres', () => {
  it('o towers.json real traz as torres provisórias da T06 (sem gatilho)', () => {
    expect(towerData.projectileRetargetRadius).toBe(2);
    expect(Object.keys(towerData.types)).toEqual([
      'basic',
      'cannon',
      'mortar',
      'reaper',
      'relay',
      'obelisk',
    ]);
    expect(towerData.types.basic).toEqual({
      name: 'Básica',
      classes: ['mechanical', 'arcane'],
      damage: 10,
      shotsPerSecond: 2,
      range: 3,
      projectileSpeed: 8,
      shot: { kind: 'single' },
      targetMode: 'first',
      trigger: null,
    });
    expect(towerData.types.cannon).toEqual({
      name: 'Canhão',
      classes: ['artillery', 'shadow'],
      damage: 8,
      shotsPerSecond: 0.8,
      range: 2.5,
      projectileSpeed: 5,
      shot: { kind: 'area', radius: 1 },
      targetMode: 'first',
      trigger: null,
    });
  });

  it.each<[string, (raw: RawTowers) => void]>([
    ['classe desconhecida', (r) => (r.types.basic!.classes = ['mechanical', 'fire'])],
    ['uma classe só', (r) => (r.types.basic!.classes = ['mechanical'])],
    ['três classes', (r) => (r.types.basic!.classes = ['mechanical', 'arcane', 'shadow'])],
    ['classe repetida', (r) => (r.types.basic!.classes = ['arcane', 'arcane'])],
    ['classe herdada (toString)', (r) => (r.types.basic!.classes = ['arcane', 'toString'])],
    ['modo de mira desconhecido', (r) => (r.types.basic!.targetMode = 'nearest')],
    ['sem modo de mira', (r) => delete r.types.basic!.targetMode],
    ['tiro de tipo desconhecido', (r) => (r.types.basic!.shot = { kind: 'laser' })],
    ['área sem raio', (r) => (r.types.cannon!.shot = { kind: 'area' })],
    ['área com raio zero', (r) => (r.types.cannon!.shot = { kind: 'area', radius: 0 })],
    ['dano zero', (r) => (r.types.basic!.damage = 0)],
    ['cadência negativa', (r) => (r.types.basic!.shotsPerSecond = -1)],
    ['alcance NaN', (r) => (r.types.basic!.range = NaN)],
    ['velocidade do projétil em texto', (r) => (r.types.basic!.projectileSpeed = '8')],
    ['sem nome', (r) => (r.types.basic!.name = '')],
    ['gatilho com "quando" desconhecido', (r) => (r.types.basic!.trigger = { when: 'fired' })],
    ['sem gatilho (precisa ser null)', (r) => delete r.types.basic!.trigger],
    ['raio de troca de alvo zero', (r) => (r.projectileRetargetRadius = 0)],
    ['nenhum tipo', (r) => (r.types = {})],
    ['tipo que não é objeto', (r) => (r.types.basic = 3 as unknown as Record<string, unknown>)],
  ])('rejeita: %s', (_name, mutate) => {
    const raw = rawTowers();
    mutate(raw);
    expect(() => loadTowerData(raw)).toThrow(/inválid/);
  });

  it('tipo pelo id, com erro para desconhecido ou herdado', () => {
    expect(getTowerType(towerData, 'basic').name).toBe('Básica');
    expect(hasTowerType(towerData, 'cannon')).toBe(true);
    expect(hasTowerType(towerData, 'toString')).toBe(false);
    expect(() => getTowerType(towerData, 'laser')).toThrow(/desconhecido/);
    expect(() => getTowerType(towerData, 'toString')).toThrow(/desconhecido/);
  });
});
