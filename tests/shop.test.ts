import { describe, expect, it } from 'vitest';
import { economyData } from '../src/sim/economy/economyData';
import { Rng } from '../src/sim/engine/rng';
import { Simulation } from '../src/sim/engine/simulation';
import { createRunState, deserializeRunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { chancesFor, newShop, priceOf, refundFor, shopPools } from '../src/sim/shop/shop';
import { RARITIES, getTowerType, towerData } from '../src/sim/towers/towerData';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';

const rarityOf = (id: string) => getTowerType(towerData, id).rarity;

function firstSlot(sim: Simulation, rarity: 'common' | 'uncommon' | 'rare'): number {
  return sim.state.shop.slots.findIndex((id) => id !== null && rarityOf(id) === rarity);
}

describe('sorteio da loja', () => {
  it('só entram as 8 torres reais (Básica e Canhão ficam de fora)', () => {
    const pools = shopPools(towerData);
    const all = [...pools.common, ...pools.uncommon, ...pools.rare];
    expect(all).toHaveLength(8);
    expect(all).not.toContain('basic');
    expect(all).not.toContain('cannon');
    expect(pools.common).toHaveLength(3);
    expect(pools.uncommon).toHaveLength(3);
    expect(pools.rare).toHaveLength(2);
  });

  it('é determinístico com a semente', () => {
    const a = newShop(new Rng({ rngState: 42 }), economyData, towerData, 1, false);
    const b = newShop(new Rng({ rngState: 42 }), economyData, towerData, 1, false);
    const c = newShop(new Rng({ rngState: 43 }), economyData, towerData, 1, false);
    expect(a).toEqual(b);
    expect(a.slots).toHaveLength(5);
    // Sementes diferentes divergem em pelo menos uma de várias tentativas.
    const others = [43, 44, 45, 46].map((s) =>
      newShop(new Rng({ rngState: s }), economyData, towerData, 1, false).slots.join(),
    );
    expect(new Set([a.slots.join(), c.slots.join(), ...others]).size).toBeGreaterThan(1);
  });

  it('a mesma semente dá a mesma primeira loja e a mesma sequência de rerolls', () => {
    const a = shopSim('igual');
    const b = shopSim('igual');
    expect(a.state.shop).toEqual(b.state.shop);
    for (const sim of [a, b]) {
      sim.state.gold = 100;
      for (let i = 0; i < 5; i++) sim.enqueue({ type: 'rerollShop' });
      stepOnce(sim);
    }
    expect(a.state.shop).toEqual(b.state.shop);
    expect(a.state.rngState).toBe(b.state.rngState);
  });

  it.each([1, 2, 3, 4, 5])('distribuição por raridade no nível %i do núcleo', (level) => {
    const samples = 6000;
    const rng = new Rng({ rngState: 12345 + level });
    const counts = { common: 0, uncommon: 0, rare: 0 };
    for (let i = 0; i < samples; i++) {
      for (const id of newShop(rng, economyData, towerData, level, false).slots) {
        counts[rarityOf(id)!]++;
      }
    }
    const total = samples * economyData.shop.slots;
    const chances = chancesFor(economyData, level);
    for (const rarity of RARITIES) {
      // 30 mil sorteios: o erro esperado é de uns 0,3 ponto percentual.
      expect(Math.abs((counts[rarity] / total) * 100 - chances[rarity])).toBeLessThan(1);
    }
  });

  it('dentro da raridade, cada torre tem a mesma chance', () => {
    const rng = new Rng({ rngState: 7 });
    const counts = new Map<string, number>();
    let commons = 0;
    for (let i = 0; i < 6000; i++) {
      for (const id of newShop(rng, economyData, towerData, 1, false).slots) {
        if (rarityOf(id) === 'common') {
          commons++;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
    expect(counts.size).toBe(3);
    for (const n of counts.values()) expect(n / commons).toBeCloseTo(1 / 3, 1);
  });

  it('sorteia com reposição: a mesma torre pode aparecer em vários slots', () => {
    const rng = new Rng({ rngState: 99 });
    const repeated = Array.from({ length: 200 }, () =>
      newShop(rng, economyData, towerData, 1, false),
    ).some((shop) => new Set(shop.slots).size < shop.slots.length);
    expect(repeated).toBe(true);
  });
});

describe('primeira loja da run', () => {
  it('sempre traz pelo menos 1 torre comum, em qualquer semente', () => {
    for (let i = 0; i < 500; i++) {
      const state = createRunState(`semente-${i}`);
      expect(state.shop.slots.some((id) => id !== null && rarityOf(id) === 'common')).toBe(true);
    }
  });

  it('quando o sorteio não traz comum, um slot vira comum; sem a garantia, vem sem', () => {
    // Nível 5 (30% de comum): acha estados em que o sorteio puro não tem comum.
    let fixed = 0;
    for (let seed = 1; seed < 4000 && fixed < 5; seed++) {
      const plain = newShop(new Rng({ rngState: seed }), economyData, towerData, 5, false);
      if (plain.slots.some((id) => rarityOf(id) === 'common')) continue;
      const guaranteed = newShop(new Rng({ rngState: seed }), economyData, towerData, 5, true);
      const changed = guaranteed.slots.filter((id, i) => id !== plain.slots[i]);
      expect(changed.length).toBeLessThanOrEqual(1);
      expect(guaranteed.slots.some((id) => rarityOf(id) === 'common')).toBe(true);
      fixed++;
    }
    expect(fixed).toBe(5);
  });

  it('o reroll é normal: pode vir sem nenhuma comum', () => {
    const rng = new Rng({ rngState: 5 });
    const some = Array.from({ length: 4000 }, () =>
      newShop(rng, economyData, towerData, 5, false),
    ).some((shop) => shop.slots.every((id) => rarityOf(id) !== 'common'));
    expect(some).toBe(true);
  });

  it('com 10 de ouro inicial, dá para comprar a primeira loja (uma comum custa 10)', () => {
    const sim = shopSim('compra-inicial');
    const slot = firstSlot(sim, 'common');
    const cell = freeCells(1)[0]!;
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.gold).toBe(0);
  });
});

describe('comprar', () => {
  it('posiciona a torre, cobra o preço, esvazia o slot e guarda o valor investido', () => {
    const sim = shopSim('compra');
    sim.state.gold = 100;
    sim.state.reportedGold = 100;
    const slot = firstSlot(sim, 'common');
    const type = sim.state.shop.slots[slot]!;
    const cell = freeCells(1)[0]!;
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    const events = stepOnce(sim);
    const [tower] = sim.state.towers;
    expect(tower).toMatchObject({ type, x: cell.x, y: cell.y, star: 1, invested: 10 });
    expect(sim.state.gold).toBe(90);
    expect(sim.state.shop.slots[slot]).toBeNull();
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['towerPlaced', 'towerBought', 'shopChanged', 'goldChanged']),
    );
  });

  it('cobra o preço da raridade (incomum 15, rara 25)', () => {
    const sim = shopSim('precos');
    sim.state.gold = 1000;
    sim.state.reportedGold = 1000;
    sim.state.shop.slots = ['reaper', 'obelisk', 'balista', 'relay', 'mortar'].map((id) =>
      id in towerData.types ? id : 'mortar',
    );
    for (const id of sim.state.shop.slots) {
      expect(priceOf(economyData, towerData, id!)).toBe(economyData.shop.prices[rarityOf(id!)!]);
    }
    expect(priceOf(economyData, towerData, 'basic')).toBeNull();
    expect(priceOf(economyData, towerData, 'nada')).toBeNull();
  });

  it('ouro insuficiente: não compra, não cobra e o slot continua', () => {
    const sim = shopSim('pobre');
    sim.state.gold = 9;
    sim.state.reportedGold = 9;
    const slot = firstSlot(sim, 'common');
    const cell = freeCells(1)[0]!;
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.state.gold).toBe(9);
    expect(sim.state.shop.slots[slot]).not.toBeNull();
  });

  it('casa inválida (caminho, fora do mapa, ocupada) não cobra e não gasta id', () => {
    const sim = shopSim('invalida');
    sim.state.gold = 100;
    sim.state.reportedGold = 100;
    const slot = firstSlot(sim, 'common');
    const slots = [...sim.state.shop.slots];
    const nextId = sim.state.nextEntityId;
    const path = realMap.entrance;
    sim.enqueue({ type: 'buyTower', slot, x: path.x, y: path.y });
    sim.enqueue({ type: 'buyTower', slot, x: -1, y: 0 });
    sim.enqueue({ type: 'buyTower', slot, x: 999, y: 999 });
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.state.gold).toBe(100);
    expect(sim.state.shop.slots).toEqual(slots);
    expect(sim.state.nextEntityId).toBe(nextId);

    // Casa ocupada: a segunda compra na mesma casa não cobra.
    const cell = freeCells(1)[0]!;
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    stepOnce(sim);
    const slot2 = sim.state.shop.slots.findIndex((id) => id !== null);
    const goldAfterFirst = sim.state.gold;
    sim.enqueue({ type: 'buyTower', slot: slot2, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.gold).toBe(goldAfterFirst);
    expect(sim.state.shop.slots[slot2]).not.toBeNull();
  });

  it('slot vazio ou inexistente não faz nada', () => {
    const sim = shopSim('vazio');
    sim.state.shop.slots[0] = null;
    const cell = freeCells(1)[0]!;
    for (const slot of [0, 5, -1, 1.5]) {
      sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    }
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.state.gold).toBe(economyData.startingGold);
  });

  it('comprar a cópia de uma torre já no mapa funde com ela, sem posicionar (T11)', () => {
    const sim = shopSim('copia');
    sim.state.gold = 100;
    sim.state.reportedGold = 100;
    const [a, b] = freeCells(2);
    sim.state.shop.slots = ['mortar', 'mortar', null, null, null];
    sim.enqueue({ type: 'buyTower', slot: 0, x: a!.x, y: a!.y });
    sim.enqueue({ type: 'buyTower', slot: 1, x: b!.x, y: b!.y });
    stepOnce(sim);
    expect(sim.state.towers.map((t) => [t.type, t.star])).toEqual([['mortar', 2]]);
  });

  it('as compras de um mesmo tick saem na ordem da fila', () => {
    const sim = shopSim('ordem');
    sim.state.gold = 10;
    sim.state.reportedGold = 10;
    const [a, b] = freeCells(2);
    sim.state.shop.slots = ['mortar', 'mortar', null, null, null];
    sim.enqueue({ type: 'buyTower', slot: 1, x: b!.x, y: b!.y });
    sim.enqueue({ type: 'buyTower', slot: 0, x: a!.x, y: a!.y });
    stepOnce(sim);
    // Ouro só para uma: vale a primeira da fila.
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.towers[0]).toMatchObject({ x: b!.x, y: b!.y });
    expect(sim.state.shop.slots[0]).toBe('mortar');
  });
});

describe('rerolar', () => {
  it('cobra 4 e troca os 5 slots, inclusive os comprados', () => {
    const sim = shopSim('reroll');
    sim.state.gold = 20;
    sim.state.reportedGold = 20;
    sim.state.shop.slots = [null, null, null, null, null];
    sim.enqueue({ type: 'rerollShop' });
    const events = stepOnce(sim);
    expect(sim.state.gold).toBe(16);
    expect(sim.state.shop.slots).toHaveLength(5);
    expect(sim.state.shop.slots.every((id) => id !== null)).toBe(true);
    expect(events.find((e) => e.type === 'shopChanged')).toMatchObject({ reason: 'reroll' });
  });

  it('sem ouro (menos de 4) não rerola e não cobra', () => {
    const sim = shopSim('reroll-pobre');
    sim.state.gold = 3;
    sim.state.reportedGold = 3;
    const before = [...sim.state.shop.slots];
    const rng = sim.state.rngState;
    sim.enqueue({ type: 'rerollShop' });
    stepOnce(sim);
    expect(sim.state.gold).toBe(3);
    expect(sim.state.shop.slots).toEqual(before);
    expect(sim.state.rngState).toBe(rng);
  });

  it('com exatamente 4 de ouro, rerola', () => {
    const sim = shopSim('reroll-4');
    sim.state.gold = 4;
    sim.state.reportedGold = 4;
    sim.enqueue({ type: 'rerollShop' });
    stepOnce(sim);
    expect(sim.state.gold).toBe(0);
  });
});

describe('vender', () => {
  it('devolve 70% do valor investido, arredondado para baixo', () => {
    expect(refundFor(economyData, 10)).toBe(7);
    expect(refundFor(economyData, 15)).toBe(10);
    expect(refundFor(economyData, 25)).toBe(17);
    expect(refundFor(economyData, 0)).toBe(0);
    expect(refundFor(economyData, 1)).toBe(0);
  });

  it('a torre sai do mapa e o ouro volta', () => {
    const sim = shopSim('venda');
    sim.state.gold = 25;
    sim.state.reportedGold = 25;
    sim.state.shop.slots = ['reaper', null, null, null, null];
    const cell = freeCells(1)[0]!;
    sim.enqueue({ type: 'buyTower', slot: 0, x: cell.x, y: cell.y });
    stepOnce(sim);
    const tower = sim.state.towers[0]!;
    expect(tower.invested).toBe(economyData.shop.prices[rarityOf('reaper')!]);
    const gold = sim.state.gold;
    sim.enqueue({ type: 'sellTower', towerId: tower.id });
    const events = stepOnce(sim);
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.state.gold).toBe(gold + refundFor(economyData, tower.invested));
    expect(events.find((e) => e.type === 'towerSold')).toMatchObject({
      towerId: tower.id,
      refund: refundFor(economyData, tower.invested),
    });
  });

  it('torre do debug tem invested 0: vender devolve 0', () => {
    const sim = shopSim('venda-debug');
    sim.enqueue({
      type: 'placeTower',
      towerType: 'basic',
      x: freeCells(1)[0]!.x,
      y: freeCells(1)[0]!.y,
    });
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, towerTypes: ['mortar'], layout: 'spread' });
    stepOnce(sim);
    expect(sim.state.towers.length).toBeGreaterThan(1);
    expect(sim.state.towers.every((t) => t.invested === 0)).toBe(true);
    const gold = sim.state.gold;
    sim.enqueue({ type: 'sellTower', towerId: sim.state.towers[0]!.id });
    stepOnce(sim);
    expect(sim.state.gold).toBe(gold);
  });

  it('id inexistente não faz nada; vale no meio do estresse (sem ondas)', () => {
    const sim = shopSim('venda-2');
    sim.enqueue({ type: 'sellTower', towerId: 999 });
    stepOnce(sim);
    expect(sim.state.gold).toBe(economyData.startingGold);

    sim.enqueue({ type: 'debugSpawnTowers', count: 5, towerTypes: ['mortar'], layout: 'spread' });
    sim.enqueue({ type: 'debugSetStress', stress: { count: 50, layout: 'spread' } });
    for (let i = 0; i < 20; i++) sim.step();
    const before = sim.state.towers.length;
    sim.enqueue({ type: 'sellTower', towerId: sim.state.towers[0]!.id });
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.state.towers).toHaveLength(before - 1);
  });

  it('vender e comprar a mesma casa no mesmo tick funciona em ordem', () => {
    const sim = shopSim('troca');
    sim.state.gold = 20;
    sim.state.reportedGold = 20;
    const cell = freeCells(1)[0]!;
    sim.state.shop.slots = ['mortar', null, null, null, null];
    sim.enqueue({ type: 'buyTower', slot: 0, x: cell.x, y: cell.y });
    stepOnce(sim);
    const id = sim.state.towers[0]!.id;
    sim.state.shop.slots = ['mortar', null, null, null, null];
    sim.enqueue({ type: 'sellTower', towerId: id });
    sim.enqueue({ type: 'buyTower', slot: 0, x: cell.x, y: cell.y });
    stepOnce(sim);
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.towers[0]!.id).not.toBe(id);
    // 20 - 10 (compra) + 7 (venda) - 10 (compra nova).
    expect(sim.state.gold).toBe(7);
  });
});

describe('loja nova grátis no fim da onda', () => {
  it('troca os 5 slots sem cobrar, inclusive os comprados', () => {
    const sim = shopSim('nova');
    sim.state.gold = 0;
    sim.state.reportedGold = 0;
    sim.state.shop.slots = [null, null, null, null, null];
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    expect(sim.state.shop.slots.every((id) => id !== null)).toBe(true);
    // Só a renda da onda 1 entrou: nenhum ouro saiu pela loja nova.
    expect(sim.state.gold).toBe(16);
    expect(events.find((e) => e.type === 'shopChanged')).toMatchObject({ reason: 'newWave' });
  });

  it('a loja nova depois da onda não tem a garantia da primeira loja', () => {
    // Nível 5 do núcleo: em muitas ondas, alguma sai sem nenhuma comum.
    const sim = shopSim('sem-garantia');
    sim.state.nexus.level = 5;
    let withoutCommon = 0;
    for (let i = 0; i < 300; i++) {
      sim.enqueue({ type: 'endWave' });
      sim.step();
      if (sim.state.shop.slots.every((id) => rarityOf(id!) !== 'common')) withoutCommon++;
    }
    expect(withoutCommon).toBeGreaterThan(0);
  });
});

describe('save no meio da run', () => {
  it('guarda loja, ouro, onda e valor investido, e a run retomada segue igual', () => {
    const map = realMap;
    const sim = shopSim('save');
    sim.state.gold = 60;
    sim.state.reportedGold = 60;
    const [a, b] = freeCells(2);
    sim.state.shop.slots = ['mortar', 'reaper', 'obelisk', null, null];
    sim.enqueue({ type: 'buyTower', slot: 0, x: a!.x, y: a!.y });
    sim.enqueue({ type: 'buyTower', slot: 1, x: b!.x, y: b!.y });
    sim.enqueue({ type: 'endWave' });
    for (let i = 0; i < 30; i++) sim.step();

    const json = sim.serialize();
    const restored = deserializeRunState(json);
    expect(restored.gold).toBe(sim.state.gold);
    expect(restored.wave).toBe(1);
    expect(restored.shop).toEqual(sim.state.shop);
    expect(restored.towers.map((t) => t.invested)).toEqual(sim.state.towers.map((t) => t.invested));
    expect(restored.towers.some((t) => t.invested > 0)).toBe(true);

    const resumed = new Simulation(restored, createGameSystems(map));
    for (const s of [sim, resumed]) {
      s.enqueue({ type: 'rerollShop' });
      for (let i = 0; i < 60; i++) s.step();
    }
    expect(resumed.serialize()).toBe(sim.serialize());
  });

  it('recusa save sem loja, sem ouro ou com torre sem invested', () => {
    const good = JSON.parse(shopSim('save-2').serialize()) as Record<string, unknown>;
    expect(() => deserializeRunState(JSON.stringify(good))).not.toThrow();
    for (const key of ['shop', 'gold', 'reportedGold', 'wave']) {
      expect(() => deserializeRunState(JSON.stringify({ ...good, [key]: undefined }))).toThrow(
        /inválido/,
      );
    }
    expect(() => deserializeRunState(JSON.stringify({ ...good, shop: { slots: [1, 2] } }))).toThrow(
      /inválido/,
    );
  });
});
