import { describe, expect, it } from 'vitest';
import { classData } from '../src/sim/classes/classData';
import { economyData } from '../src/sim/economy/economyData';
import { towerData } from '../src/sim/towers/towerData';
import { buildShopModel, canPlaceAt, shopModelKey } from '../src/ui/shopModel';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';

const model = (
  sim: ReturnType<typeof shopSim>,
  selected = null as { x: number; y: number } | null,
) => buildShopModel(sim.state, selected, economyData, towerData, classData);

describe('modelo da loja', () => {
  it('mostra ouro, juros previstos e a próxima onda', () => {
    const sim = shopSim('modelo');
    sim.state.gold = 87;
    const m = model(sim);
    expect(m.gold).toBe(87);
    expect(m.interest).toBe(8);
    expect(m.nextWave).toBe(1);
    sim.state.gold = 500;
    expect(model(sim).interest).toBe(15);
  });

  it('cada slot traz nome, classes, raridade e preço; sem ouro fica esmaecido', () => {
    const sim = shopSim('modelo-2');
    sim.state.shop.slots = ['mortar', 'reaper', null, 'obelisk', 'relay'];
    sim.state.gold = 12;
    const m = model(sim);
    expect(m.slots).toHaveLength(5);
    const first = m.slots[0]!;
    expect(first.name).toBe(towerData.types.mortar!.name);
    expect(first.classes).toHaveLength(2);
    expect(first.price).toBe(economyData.shop.prices[towerData.types.mortar!.rarity!]);
    expect(first.affordable).toBe(first.price <= 12);
    expect(m.slots[2]).toMatchObject({ towerType: null, affordable: false });
    for (const s of m.slots) {
      if (s.towerType) expect(s.affordable).toBe(12 >= s.price);
    }
  });

  it('o reroll fica desabilitado abaixo de 4 de ouro', () => {
    const sim = shopSim('modelo-3');
    sim.state.gold = 3;
    expect(model(sim).canReroll).toBe(false);
    sim.state.gold = 4;
    expect(model(sim).canReroll).toBe(true);
  });

  it('a torre da casa selecionada vira alvo de venda, com o valor devolvido', () => {
    const sim = shopSim('modelo-4');
    const cell = freeCells(1)[0]!;
    sim.state.shop.slots = ['mortar', null, null, null, null];
    sim.enqueue({ type: 'buyTower', slot: 0, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(model(sim).sell).toBeNull();
    expect(model(sim, { x: cell.x + 1, y: cell.y }).sell).toBeNull();
    const sell = model(sim, cell).sell!;
    expect(sell.towerId).toBe(sim.state.towers[0]!.id);
    expect(sell.refund).toBe(Math.floor((sim.state.towers[0]!.invested * 70) / 100));
  });

  it('a assinatura muda com ouro, loja, seleção e torre presa', () => {
    const sim = shopSim('modelo-5');
    const base = shopModelKey(model(sim), null);
    expect(shopModelKey(model(sim), null)).toBe(base);
    expect(shopModelKey(model(sim), 2)).not.toBe(base);
    sim.state.gold += 1;
    expect(shopModelKey(model(sim), null)).not.toBe(base);
  });
});

describe('casa válida para construir', () => {
  it('rejeita caminho, fora do mapa e casa com torre', () => {
    const sim = shopSim('casa');
    const cell = freeCells(1)[0]!;
    expect(canPlaceAt(sim.state, realMap, cell)).toBe(true);
    expect(canPlaceAt(sim.state, realMap, realMap.entrance)).toBe(false);
    expect(canPlaceAt(sim.state, realMap, { x: -1, y: 0 })).toBe(false);
    sim.state.shop.slots = ['mortar', null, null, null, null];
    sim.state.gold = 50;
    sim.enqueue({ type: 'buyTower', slot: 0, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(canPlaceAt(sim.state, realMap, cell)).toBe(false);
  });
});
