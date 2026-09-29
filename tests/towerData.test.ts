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
  it('as 4 classes do protótipo carregam com nome', () => {
    expect(classData).toEqual({
      artillery: { name: 'Artilharia' },
      mechanical: { name: 'Mecânica' },
      arcane: { name: 'Arcana' },
      shadow: { name: 'Sombria' },
    });
  });

  it.each([
    ['não é objeto', []],
    ['vazio', {}],
    ['classe sem nome', { artillery: {} }],
    ['nome vazio', { artillery: { name: '' } }],
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
