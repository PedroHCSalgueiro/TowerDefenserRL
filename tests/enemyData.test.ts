import { describe, expect, it } from 'vitest';
import enemiesJson from '../src/data/enemies.json';
import nexusJson from '../src/data/nexus.json';
import { applyArmor } from '../src/sim/enemies/armor';
import { enemyData, getEnemyType, loadEnemyData } from '../src/sim/enemies/enemyData';
import { loadNexusData, nexusData } from '../src/sim/nexus/nexusData';

describe('applyArmor', () => {
  const params = { scale: 100 };

  it('sem armadura, o dano passa inteiro', () => {
    expect(applyArmor(12, 0, params)).toBe(12);
  });

  it('dano = bruto × scale / (scale + armadura)', () => {
    expect(applyArmor(30, 50, params)).toBeCloseTo(20, 12);
    expect(applyArmor(10, 100, params)).toBe(5);
    expect(applyArmor(10, 100, { scale: 50 })).toBeCloseTo(10 / 3, 12);
  });

  it('armadura alta reduz muito, mas o dano nunca zera', () => {
    expect(applyArmor(1, 10_000, params)).toBeGreaterThan(0);
  });
});

describe('dados de inimigos', () => {
  it('enemies.json tem os 4 tipos do protótipo', () => {
    expect(Object.keys(enemyData.types)).toEqual(['common', 'fast', 'armored', 'flying']);
    expect(getEnemyType(enemyData, 'flying').movement).toBe('air');
    expect(getEnemyType(enemyData, 'armored').armor).toBe(50);
    expect(enemyData.armor.scale).toBe(100);
  });

  it('o blindado leva cerca de 33% menos dano', () => {
    const armored = getEnemyType(enemyData, 'armored');
    expect(1 - applyArmor(1, armored.armor, enemyData.armor)).toBeCloseTo(1 / 3, 12);
  });

  it('tipo desconhecido é erro, inclusive chaves herdadas', () => {
    expect(() => getEnemyType(enemyData, 'dragon')).toThrow(/desconhecido/);
    expect(() => getEnemyType(enemyData, 'toString')).toThrow(/desconhecido/);
  });

  it('rejeita dados inválidos', () => {
    const common = enemiesJson.types.common;
    const withType = (type: unknown) => ({ armor: { scale: 100 }, types: { x: type } });
    expect(() => loadEnemyData(withType({ ...common, speed: 0 }))).toThrow(/"x"/);
    expect(() => loadEnemyData(withType({ ...common, armor: -1 }))).toThrow(/"x"/);
    expect(() => loadEnemyData(withType({ ...common, movement: 'swim' }))).toThrow(/"x"/);
    expect(() => loadEnemyData(withType({ ...common, hp: undefined }))).toThrow(/"x"/);
    expect(() => loadEnemyData({ armor: { scale: 100 }, types: {} })).toThrow(/nenhum tipo/);
    expect(() => loadEnemyData({ armor: { scale: 0 }, types: {} })).toThrow(/scale/);
    expect(() => loadEnemyData({ types: {} })).toThrow(/armor/);
  });
});

describe('dados do núcleo', () => {
  it('nexus.json carrega com alcance de 3 casas', () => {
    expect(nexusData.attack.range).toBe(3);
    expect(nexusData.maxHp).toBe(nexusJson.maxHp);
  });

  it('rejeita dados inválidos', () => {
    expect(() => loadNexusData({ ...nexusJson, maxHp: 0 })).toThrow(/núcleo/);
    expect(() => loadNexusData({ maxHp: 10 })).toThrow(/núcleo/);
    expect(() =>
      loadNexusData({ ...nexusJson, attack: { ...nexusJson.attack, range: -1 } }),
    ).toThrow(/núcleo/);
    expect(() => loadNexusData(null)).toThrow(/núcleo/);
  });
});
