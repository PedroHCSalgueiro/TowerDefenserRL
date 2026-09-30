import { describe, expect, it } from 'vitest';
import { classData } from '../src/sim/classes/classData';
import { economyData } from '../src/sim/economy/economyData';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation } from '../src/sim/engine/simulation';
import { createGameSystems } from '../src/sim/systems';
import { planFusion } from '../src/sim/towers/fusion';
import { towerData } from '../src/sim/towers/towerData';
import { triggerAt } from '../src/sim/triggers/triggerData';
import { buildShopModel } from '../src/ui/shopModel';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';

const PRICE = economyData.shop.prices.common;
const TYPE = 'mortar'; // comum

/** Posiciona por comando (como o debug: invested 0) e devolve o id. */
function put(sim: Simulation, type: string, cellIndex: number, star = 1): number {
  const cell = freeCells(cellIndex + 1)[cellIndex]!;
  sim.enqueue({ type: 'placeTower', towerType: type, x: cell.x, y: cell.y, star });
  stepOnce(sim);
  return sim.state.towers.find((t) => t.x === cell.x && t.y === cell.y)!.id;
}

/** Compra o slot 0 com o tipo dado (por cima da loja sorteada). */
function buy(sim: Simulation, type: string, cell?: { x: number; y: number }): SimEvent[] {
  sim.state.shop.slots[0] = type;
  sim.state.gold = Math.max(sim.state.gold, 100);
  sim.enqueue({ type: 'buyTower', slot: 0, ...cell });
  return stepOnce(sim);
}

const byId = (sim: Simulation, id: number) => sim.state.towers.find((t) => t.id === id);

describe('fusão simples (★1 + ★1)', () => {
  it('funde na hora, sem casa, e cobra o preço cheio', () => {
    const sim = shopSim('f1');
    const a = put(sim, TYPE, 0);
    const before = (sim.state.gold = 50);
    sim.state.shop.slots[0] = TYPE;
    sim.enqueue({ type: 'buyTower', slot: 0 });
    const events = stepOnce(sim);
    expect(sim.state.towers).toHaveLength(1);
    expect(byId(sim, a)!.star).toBe(2);
    expect(sim.state.gold).toBe(before - PRICE);
    expect(sim.state.shop.slots[0]).toBeNull();
    expect(events.filter((e) => e.type === 'towerPlaced')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'towersMerged')).toEqual([
      expect.objectContaining({ towerId: a, stars: 2, absorbedIds: [], towerType: TYPE }),
    ]);
    expect(events.find((e) => e.type === 'towerBought')).toMatchObject({
      towerId: a,
      fused: true,
      price: PRICE,
    });
  });

  it('ignora a casa pedida (arrastar um slot que funde) e não gasta id', () => {
    const sim = shopSim('f2');
    put(sim, TYPE, 0);
    const idBefore = sim.state.nextEntityId;
    buy(sim, TYPE, freeCells(5)[4]);
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.nextEntityId).toBe(idBefore);
  });

  it('sem ouro, não funde nem cobra', () => {
    const sim = shopSim('f3');
    const a = put(sim, TYPE, 0);
    sim.state.shop.slots[0] = TYPE;
    sim.state.gold = PRICE - 1;
    sim.enqueue({ type: 'buyTower', slot: 0 });
    stepOnce(sim);
    expect(byId(sim, a)!.star).toBe(1);
    expect(sim.state.gold).toBe(PRICE - 1);
    expect(sim.state.shop.slots[0]).toBe(TYPE);
  });

  it('tipo diferente não funde: exige casa e posiciona como ★1', () => {
    const sim = shopSim('f4');
    put(sim, TYPE, 0);
    buy(sim, 'reaper'); // sem casa: recusa, nada cobrado
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.shop.slots[0]).toBe('reaper');
    const cell = freeCells(2)[1]!;
    buy(sim, 'reaper', cell);
    expect(sim.state.towers).toHaveLength(2);
    expect(sim.state.towers[1]).toMatchObject({ type: 'reaper', star: 1 });
  });
});

describe('cascata (★1 + ★1 com uma ★2 no mapa → ★3)', () => {
  it('sobrevive a ★2 original, na casa dela; a ★1 some e a casa fica livre', () => {
    const sim = shopSim('c1');
    const one = put(sim, TYPE, 0, 1); // id menor, mas ★1
    const two = put(sim, TYPE, 1, 2);
    const twoCell = { x: byId(sim, two)!.x, y: byId(sim, two)!.y };
    const oneCell = { x: byId(sim, one)!.x, y: byId(sim, one)!.y };
    const events = buy(sim, TYPE);
    expect(sim.state.towers.map((t) => t.id)).toEqual([two]);
    expect(byId(sim, two)).toMatchObject({ star: 3, ...twoCell });
    expect(sim.state.towers.some((t) => t.x === oneCell.x && t.y === oneCell.y)).toBe(false);
    const merged = events.filter((e) => e.type === 'towersMerged');
    expect(merged).toEqual([
      expect.objectContaining({ stars: 2, absorbedIds: [] }),
      expect.objectContaining({ towerId: two, stars: 3, absorbedIds: [one], ...twoCell }),
    ]);
    expect(events.find((e) => e.type === 'towerBought')).toMatchObject({ towerId: two });
  });

  it('a casa liberada aceita uma torre nova', () => {
    const sim = shopSim('c2');
    put(sim, TYPE, 0, 1);
    put(sim, TYPE, 1, 2);
    buy(sim, TYPE);
    const free = freeCells(1)[0]!;
    buy(sim, 'reaper', free);
    expect(sim.state.towers.find((t) => t.type === 'reaper')).toMatchObject(free);
  });

  it('várias candidatas do mesmo tipo e estrela (debug): a de menor id', () => {
    const sim = shopSim('c3');
    const a = put(sim, TYPE, 0, 1);
    put(sim, TYPE, 1, 1);
    const c = put(sim, TYPE, 2, 2);
    put(sim, TYPE, 3, 2);
    const plan = planFusion(sim.state.towers, towerData, TYPE)!;
    expect(plan.survivorId).toBe(c);
    expect(plan.absorbedIds).toEqual([a]);
  });
});

describe('limite ★3', () => {
  it('com só uma ★3 no mapa, a compra vira uma ★1 separada, que precisa de casa', () => {
    const sim = shopSim('l1');
    const big = put(sim, TYPE, 0, 3);
    expect(planFusion(sim.state.towers, towerData, TYPE)).toBeNull();
    buy(sim, TYPE); // sem casa: recusa
    expect(sim.state.towers).toHaveLength(1);
    const cell = freeCells(2)[1]!;
    buy(sim, TYPE, cell);
    expect(sim.state.towers).toHaveLength(2);
    expect(byId(sim, big)!.star).toBe(3);
    expect(sim.state.towers[1]).toMatchObject({ star: 1, ...cell });
  });

  it('duas ★3 não se fundem e nenhuma torre passa da ★3', () => {
    const sim = shopSim('l2');
    put(sim, TYPE, 0, 3);
    put(sim, TYPE, 1, 3);
    expect(planFusion(sim.state.towers, towerData, TYPE)).toBeNull();
    expect(Math.max(...sim.state.towers.map((t) => t.star))).toBe(3);
  });

  it('só ★2 no mapa (sem ★1): não funde', () => {
    const sim = shopSim('l3');
    put(sim, TYPE, 0, 2);
    expect(planFusion(sim.state.towers, towerData, TYPE)).toBeNull();
  });
});

describe('estado da sobrevivente e invested', () => {
  it('mantém id, casa, recarga, contadores, trava e último efeito', () => {
    const sim = shopSim('s1');
    const a = put(sim, TYPE, 0);
    const t = byId(sim, a)!;
    Object.assign(t, {
      cooldownTicks: 5,
      triggerCounter: 2,
      activationReadyTick: 999,
      lastEffect: { effect: { kind: 'chargeLightning' }, seq: 7 },
    });
    const { x, y } = t;
    buy(sim, TYPE);
    const after = byId(sim, a)!;
    expect(after).toMatchObject({ x, y, triggerCounter: 2, activationReadyTick: 999 });
    expect(after.cooldownTicks).toBeGreaterThanOrEqual(0);
    expect(after.lastEffect).toMatchObject({ seq: 7 });
  });

  it('as cargas do Obelisco ficam no teto da nova estrela', () => {
    const cap = (star: number) => {
      const effect = triggerAt(towerData.types.obelisk!.trigger!, star).effect;
      if (effect.kind !== 'chargeLightning') throw new Error('Obelisco sem raio em cadeia');
      return effect.charges;
    };
    expect(cap(3)).toBeLessThan(cap(2)); // a ★3 tem teto menor
    const sim = shopSim('s2');
    put(sim, 'obelisk', 0, 2);
    put(sim, 'obelisk', 1, 1);
    const two = sim.state.towers[0]!;
    two.charges = cap(2);
    buy(sim, 'obelisk'); // cascata: ★1 + ★1 → ★2 encontra a ★2 → ★3
    expect(two.star).toBe(3);
    expect(two.charges).toBe(cap(3));
  });

  it('invested soma as cópias (debug = 0) e a venda devolve 70% da soma', () => {
    const sim = shopSim('s3');
    const cells = freeCells(3);
    sim.state.gold = 100;
    sim.state.shop.slots = [TYPE, TYPE, TYPE, null, null];
    sim.enqueue({ type: 'buyTower', slot: 0, ...cells[0]! });
    stepOnce(sim);
    const a = sim.state.towers[0]!;
    expect(a.invested).toBe(PRICE);
    sim.enqueue({ type: 'buyTower', slot: 1 });
    stepOnce(sim);
    expect(a.star).toBe(2);
    expect(a.invested).toBe(PRICE * 2);
    put(sim, TYPE, 2, 1); // debug, invested 0
    const gold = sim.state.gold;
    sim.enqueue({ type: 'buyTower', slot: 2 }); // ★1 de debug + compra: funde (★1 do mapa) e cascata com a ★2
    const events = stepOnce(sim);
    expect(events.filter((e) => e.type === 'towersMerged')).toHaveLength(2);
    expect(sim.state.towers).toHaveLength(1);
    expect(a.star).toBe(3);
    expect(a.invested).toBe(PRICE * 3);
    sim.enqueue({ type: 'sellTower', towerId: a.id });
    stepOnce(sim);
    expect(sim.state.gold).toBe(gold - PRICE + Math.floor((PRICE * 3 * 70) / 100));
    expect(sim.state.towers).toHaveLength(0);
  });
});

describe('torres de debug', () => {
  it('30 do mesmo tipo em debugSpawnTowers não se fundem sozinhas', () => {
    const sim = shopSim('d1');
    sim.enqueue({ type: 'debugSpawnTowers', count: 30, towerTypes: [TYPE], layout: 'spread' });
    const events = stepOnce(sim);
    expect(sim.state.towers).toHaveLength(30);
    expect(sim.state.towers.every((t) => t.star === 1)).toBe(true);
    expect(events.filter((e) => e.type === 'towersMerged')).toHaveLength(0);
    for (let i = 0; i < 5; i++) stepOnce(sim);
    expect(sim.state.towers).toHaveLength(30);
  });

  it('uma compra funde com uma torre de debug do mesmo tipo e estrela', () => {
    const sim = shopSim('d2');
    sim.enqueue({ type: 'debugSpawnTowers', count: 3, towerTypes: [TYPE], layout: 'spread' });
    stepOnce(sim);
    const lowest = Math.min(...sim.state.towers.map((t) => t.id));
    buy(sim, TYPE);
    expect(sim.state.towers).toHaveLength(3); // nada foi absorvido: ★1 + compra → ★2
    expect(byId(sim, lowest)!.star).toBe(2);
    expect(byId(sim, lowest)!.invested).toBe(PRICE);
  });
});

describe('aviso do slot da loja', () => {
  const model = (sim: Simulation) =>
    buildShopModel(sim.state, null, economyData, towerData, classData);

  it('mostra a estrela do resultado real: ★2, ★3 na cascata e nada no limite', () => {
    const sim = shopSim('a1');
    sim.state.gold = 100;
    sim.state.shop.slots = [TYPE, 'reaper', null, null, null];
    expect(model(sim).slots[0]!.fuseStar).toBeNull();
    put(sim, TYPE, 0, 1);
    expect(model(sim).slots[0]!.fuseStar).toBe(2);
    expect(model(sim).slots[1]!.fuseStar).toBeNull();
    put(sim, TYPE, 1, 2);
    expect(model(sim).slots[0]!.fuseStar).toBe(3);
    expect(model(sim).slots[2]!.fuseStar).toBeNull();
  });

  it.each([
    ['sem nada', []],
    ['★1', [1]],
    ['★1 e ★2', [1, 2]],
    ['só ★2', [2]],
    ['só ★3', [3]],
    ['★1, ★2 e ★3', [1, 2, 3]],
    ['duas ★1 e duas ★2', [1, 1, 2, 2]],
  ])('o aviso bate com a estrela da sobrevivente após a compra (%s)', (_name, stars) => {
    const sim = shopSim('a2');
    stars.forEach((s, i) => put(sim, TYPE, i, s));
    sim.state.shop.slots[0] = TYPE;
    sim.state.gold = 100;
    const warned = model(sim).slots[0]!.fuseStar;
    const cell = freeCells(10)[9]!;
    const before = new Set(sim.state.towers.map((t) => t.id));
    sim.enqueue({ type: 'buyTower', slot: 0, ...cell });
    stepOnce(sim);
    if (warned === null) {
      // Sem fusão: entrou uma ★1 nova.
      expect(sim.state.towers.filter((t) => !before.has(t.id))).toHaveLength(1);
    } else {
      expect(sim.state.towers.filter((t) => !before.has(t.id))).toHaveLength(0);
      expect(Math.max(...sim.state.towers.map((t) => t.star))).toBe(warned);
      expect(sim.state.towers).toHaveLength(
        before.size - (warned === 3 && stars.includes(1) ? 1 : 0),
      );
    }
  });
});

describe('fusão no meio da onda, determinismo e save', () => {
  function scenario(): Simulation {
    const sim = Simulation.create('onda', createGameSystems(realMap));
    sim.state.gold = 500;
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: 8,
      towerTypes: ['relay', TYPE, 'obelisk', 'reaper'],
      layout: 'spread',
    });
    sim.enqueue({ type: 'debugSpawnEnemies', count: 300, enemyType: null, layout: 'spread' });
    for (let i = 0; i < 40; i++) sim.step();
    return sim;
  }

  function fuseAndRun(sim: Simulation, ticks: number): void {
    const type = sim.state.towers[1]!.type;
    sim.state.shop.slots[0] = type;
    sim.enqueue({ type: 'buyTower', slot: 0 });
    for (let i = 0; i < ticks; i++) sim.step();
  }

  it('funde com inimigos e gatilhos em andamento, sem quebrar', () => {
    const sim = scenario();
    const count = sim.state.towers.length;
    fuseAndRun(sim, 1);
    expect(sim.state.towers.length).toBe(count); // ★1 do mapa absorveu a compra
    expect(sim.state.towers.some((t) => t.star === 2)).toBe(true);
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.state.status).toBeDefined();
  });

  it('a mesma semente dá o mesmo estado depois da fusão', () => {
    const a = scenario();
    const b = scenario();
    fuseAndRun(a, 80);
    fuseAndRun(b, 80);
    expect(a.serialize()).toBe(b.serialize());
  });

  it('salvar logo depois da fusão e retomar dá o mesmo resultado', () => {
    const a = scenario();
    fuseAndRun(a, 1);
    const b = Simulation.restore(a.serialize(), createGameSystems(realMap));
    for (let i = 0; i < 120; i++) {
      a.step();
      b.step();
    }
    expect(b.serialize()).toBe(a.serialize());
  });
});
