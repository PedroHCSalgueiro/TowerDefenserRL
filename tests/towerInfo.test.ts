import { describe, expect, it } from 'vitest';
import { classData } from '../src/sim/classes/classData';
import { maxStars } from '../src/sim/towers/stars';
import { getTowerType, towerData, type TowerType } from '../src/sim/towers/towerData';
import { describeTower, fmt } from '../src/ui/towerInfo';

const info = (id: string, star = 1) => describeTower(getTowerType(towerData, id), star, classData);

describe('janela de informações da torre', () => {
  it('o Relé ativa as vizinhas, e o texto acompanha a estrela', () => {
    const one = info('relay', 1);
    expect(one.title).toBe('Relé ★1');
    expect(one.subtitle).toBe('Arcana · Mecânica · Comum');
    expect(one.trigger).toContain('Sempre que atira');
    expect(one.trigger).toContain('ativa todas as vizinhas');
    expect(one.trigger).toContain('um tiro extra');

    expect(info('relay', 2).trigger).toContain('150% do dano');
    const three = info('relay', 3).trigger!;
    expect(three).toContain('200% do dano');
    expect(three).toContain('alcance ampliado em 2');
  });

  it('mostra o ataque normal com dano da estrela, cadência, alcance e área', () => {
    expect(info('relay').attack).toBe('Dano 5 · 1,5 tiros/s · alcance 3');
    // Morteiro ★2 tem 125% do dano do ataque (8 → 10) e tiro em área.
    expect(info('mortar', 2).attack).toBe('Dano 10 · 0,8 tiros/s · alcance 3, área de raio 1');
  });

  it('o Espelho não ataca sozinho e copia efeitos', () => {
    const mirror = info('mirror', 3);
    expect(mirror.attack).toBe('Não ataca por conta própria');
    expect(mirror.trigger).toContain('copia os últimos efeitos de 2 vizinhas diferentes');
    expect(mirror.trigger).toContain('150% do dano');
  });

  it('singular quando é 1: 1 tiro/s e 1 abate', () => {
    expect(info('reaper').attack).toContain('1 tiro/s');
    expect(info('executioner').trigger).toContain('conta como 2 abates');
    expect(info('mirror', 1).trigger).toContain('copia o último efeito de uma vizinha');
  });

  it('estrela fora do intervalo é presa entre ★1 e a última', () => {
    expect(info('relay', 9).title).toBe('Relé ★3');
    expect(info('relay', 0).title).toBe('Relé ★1');
  });

  it('torre de teste (sem gatilho, sem classes) não quebra', () => {
    const basic = info('basic');
    expect(basic.title).toBe('Básica');
    expect(basic.trigger).toBeNull();
    expect(basic.attack).toContain('tiros/s');
  });

  it('as 8 torres em todas as estrelas geram texto completo, sem "undefined" nem "NaN"', () => {
    const shopTowers = Object.entries(towerData.types).filter(([, t]) => t.rarity !== null);
    expect(shopTowers).toHaveLength(8);
    for (const [id, type] of shopTowers) {
      for (let star = 1; star <= maxStars(type); star++) {
        const i = info(id, star);
        const all = [i.title, i.subtitle, i.attack, i.trigger].join(' ');
        expect(all, `${id} ★${star}`).not.toMatch(/undefined|NaN|\[object/);
        expect(i.trigger, `${id} ★${star}`).toMatch(/^.+: .+\.$/);
      }
    }
  });

  it('os números vêm dos dados: mudar o dado muda o texto', () => {
    const base = getTowerType(towerData, 'mortar');
    const changed = {
      ...base,
      trigger: {
        stars: [{ ...base.trigger!.stars[0]!, when: { kind: 'everyNShots', shots: 9 } }],
      },
    } as TowerType;
    expect(describeTower(changed, 1, classData).trigger).toContain('A cada 9 tiros');
    expect(info('mortar', 1).trigger).toContain('A cada 5 tiros');
  });

  it('formata números no padrão brasileiro', () => {
    expect(fmt(0.8)).toBe('0,8');
    expect(fmt(1.3)).toBe('1,3');
    expect(fmt(8)).toBe('8');
    expect(fmt(1.333)).toBe('1,33');
  });
});
