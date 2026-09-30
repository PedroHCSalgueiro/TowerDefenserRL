import { describe, expect, it } from 'vitest';
import { economyData } from '../src/sim/economy/economyData';
import type { SimEvent } from '../src/sim/engine/events';
import type { Simulation } from '../src/sim/engine/simulation';
import { nexusData, towerLimit } from '../src/sim/nexus/nexusData';
import { deserializeRunState, serializeRunState } from '../src/sim/state';
import { newShop } from '../src/sim/shop/shop';
import { Rng } from '../src/sim/engine/rng';
import { classData } from '../src/sim/classes/classData';
import { hasRoomForTower, towerCount } from '../src/sim/towers/limit';
import { getTowerType, towerData } from '../src/sim/towers/towerData';
import { fusionFlashes } from '../src/render/views/fusionFlash';
import { buildNexusPanelModel } from '../src/ui/nexusPanelModel';
import { buildShopModel } from '../src/ui/shopModel';
import { freeCells, shopSim, stepOnce } from './support/shopSim';

const COMMON = 'mortar';
const cost = (level: number) => nexusData.levels[level - 1]!.cost;

/** Torres diferentes de `COMMON`, para encher o mapa sem fundir. */
function distinctTypes(): string[] {
  return Object.entries(towerData.types)
    .filter(([id, t]) => id !== COMMON && t.rarity !== null)
    .map(([id]) => id);
}

function place(sim: Simulation, type: string, cellIndex: number): void {
  const cell = freeCells(cellIndex + 1)[cellIndex]!;
  sim.enqueue({ type: 'placeTower', towerType: type, x: cell.x, y: cell.y });
  stepOnce(sim);
}

/** Enche o mapa até o limite do nível com tipos diferentes (sem fusão possível). */
function fillToLimit(sim: Simulation): void {
  const types = distinctTypes();
  const limit = towerLimit(nexusData, sim.state.nexus.level);
  for (let i = 0; i < limit; i++) place(sim, types[i % types.length]!, i);
}

function buy(sim: Simulation, slot: number, cell?: { x: number; y: number }): SimEvent[] {
  sim.enqueue({ type: 'buyTower', slot, ...cell });
  return stepOnce(sim);
}

describe('dados do núcleo', () => {
  it('a tabela de níveis e a de chances têm o mesmo tamanho', () => {
    expect(nexusData.levels).toHaveLength(economyData.shop.rarityChances.length);
  });
});

describe('limite de torres', () => {
  it('o nível 1 permite 3 torres', () => {
    const sim = shopSim('lim');
    expect(towerLimit(nexusData, sim.state.nexus.level)).toBe(3);
    expect(hasRoomForTower(sim.state)).toBe(true);
  });

  it('bloqueia a compra no limite, sem cobrar nem esvaziar o slot', () => {
    const sim = shopSim('lim');
    fillToLimit(sim);
    sim.state.shop.slots[0] = COMMON;
    sim.state.gold = 100;
    const cell = freeCells(10)[9]!;
    const events = buy(sim, 0, cell);
    expect(sim.state.towers).toHaveLength(3);
    expect(sim.state.gold).toBe(100);
    expect(sim.state.shop.slots[0]).toBe(COMMON);
    expect(events.find((e) => e.type === 'buyRefused')).toMatchObject({ slot: 0, reason: 'limit' });
    expect(events.some((e) => e.type === 'towerBought')).toBe(false);
  });

  it('a fusão continua permitida com o limite cheio (simples e cascata)', () => {
    const sim = shopSim('lim');
    place(sim, COMMON, 0);
    const [t2, t3] = distinctTypes();
    place(sim, t2!, 1);
    place(sim, t3!, 2);
    expect(towerCount(sim.state)).toBe(3);
    sim.state.shop.slots[0] = COMMON;
    sim.state.gold = 100;
    buy(sim, 0);
    expect(towerCount(sim.state)).toBe(3);
    expect(sim.state.towers.find((t) => t.type === COMMON)!.star).toBe(2);
    // Cascata: ★1 nova + ★1 e ★2... troca uma torre por outra ★1 do tipo e funde de novo.
    sim.state.towers.find((t) => t.type === t2)!.type = COMMON;
    sim.state.shop.slots[1] = COMMON;
    const events = buy(sim, 1);
    expect(sim.state.towers.filter((t) => t.type === COMMON)).toHaveLength(1);
    expect(sim.state.towers.find((t) => t.type === COMMON)!.star).toBe(3);
    expect(towerCount(sim.state)).toBe(2);
    expect(events.some((e) => e.type === 'buyRefused')).toBe(false);
  });

  it('vender libera espaço', () => {
    const sim = shopSim('lim');
    fillToLimit(sim);
    expect(hasRoomForTower(sim.state)).toBe(false);
    sim.enqueue({ type: 'sellTower', towerId: sim.state.towers[0]!.id });
    stepOnce(sim);
    expect(hasRoomForTower(sim.state)).toBe(true);
    sim.state.shop.slots[0] = COMMON;
    sim.state.gold = 100;
    buy(sim, 0, freeCells(10)[9]!);
    expect(sim.state.towers).toHaveLength(3);
    expect(sim.state.towers.some((t) => t.type === COMMON)).toBe(true);
  });

  it('o spawn de debug ignora o limite, mas as torres contam no total', () => {
    const sim = shopSim('lim');
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: 30,
      towerTypes: [COMMON],
      layout: 'spread',
    });
    stepOnce(sim);
    expect(sim.state.towers.length).toBeGreaterThan(3);
    expect(towerCount(sim.state)).toBe(sim.state.towers.length);
    expect(hasRoomForTower(sim.state)).toBe(false);
    // Acima do limite, só a compra que funde passa.
    sim.state.shop.slots[0] = distinctTypes()[0]!;
    sim.state.gold = 100;
    expect(buy(sim, 0, freeCells(50)[49]!).some((e) => e.type === 'buyRefused')).toBe(true);
  });

  it('o placeTower cru não aplica o limite', () => {
    const sim = shopSim('lim');
    for (let i = 0; i < 5; i++) place(sim, COMMON, i);
    expect(sim.state.towers).toHaveLength(5);
  });
});

describe('evoluir o núcleo', () => {
  it('cobra o custo, sobe o nível, o limite e a vida máxima, e cura 5', () => {
    const sim = shopSim('evo');
    sim.state.gold = 50;
    sim.state.nexus.hp = 12;
    sim.enqueue({ type: 'evolveNexus' });
    const events = stepOnce(sim);
    expect(sim.state.gold).toBe(50 - cost(2));
    expect(sim.state.nexus).toMatchObject({ level: 2, maxHp: 25, hp: 17 });
    expect(towerLimit(nexusData, 2)).toBe(4);
    expect(events.find((e) => e.type === 'nexusEvolved')).toMatchObject({
      level: 2,
      hp: 17,
      maxHp: 25,
      cost: 20,
    });
  });

  it('com a vida cheia, a vida sobe junto com o máximo (20 para 25)', () => {
    const sim = shopSim('evo');
    sim.state.gold = 50;
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(sim.state.nexus.hp).toBe(25);
  });

  it('a cura nunca passa da vida máxima e não enche a barra', () => {
    const sim = shopSim('evo');
    sim.state.gold = 50;
    sim.state.nexus.hp = 1;
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(sim.state.nexus.hp).toBe(6);
  });

  it('sem ouro suficiente não faz nada e não cobra', () => {
    const sim = shopSim('evo');
    sim.state.gold = cost(2) - 1;
    sim.enqueue({ type: 'evolveNexus' });
    const events = stepOnce(sim);
    expect(sim.state.nexus.level).toBe(1);
    expect(sim.state.gold).toBe(cost(2) - 1);
    expect(events.some((e) => e.type === 'nexusEvolved')).toBe(false);
  });

  it('sobe até o nível 5 pagando cada custo e para no máximo', () => {
    const sim = shopSim('evo');
    sim.state.gold = 1000;
    for (let i = 0; i < 6; i++) {
      sim.enqueue({ type: 'evolveNexus' });
      stepOnce(sim);
    }
    expect(sim.state.nexus).toMatchObject({ level: 5, maxHp: 40 });
    expect(sim.state.gold).toBe(1000 - cost(2) - cost(3) - cost(4) - cost(5));
    expect(towerLimit(nexusData, 5)).toBe(8);
  });

  it('com a run perdida, não faz nada', () => {
    const sim = shopSim('evo');
    sim.state.gold = 50;
    sim.state.status = 'lost';
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(sim.state.nexus.level).toBe(1);
    expect(sim.state.gold).toBe(50);
  });

  it('funciona no meio da onda, com inimigos na tela', () => {
    const sim = shopSim('evo');
    sim.enqueue({ type: 'debugSpawnEnemies', count: 20, enemyType: null, layout: 'spread' });
    for (let i = 0; i < 20; i++) sim.step();
    sim.state.gold = 50;
    sim.enqueue({ type: 'evolveNexus' });
    sim.step();
    expect(sim.state.nexus.level).toBe(2);
    expect(sim.state.enemies.activeCount).toBeGreaterThan(0);
  });

  it('evoluir libera espaço para o limite', () => {
    const sim = shopSim('evo');
    fillToLimit(sim);
    expect(hasRoomForTower(sim.state)).toBe(false);
    sim.state.gold = 50;
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(hasRoomForTower(sim.state)).toBe(true);
  });
});

describe('chances de raridade depois de evoluir', () => {
  it('a loja atual não muda ao evoluir', () => {
    const sim = shopSim('evo');
    const before = [...sim.state.shop.slots];
    sim.state.gold = 50;
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(sim.state.shop.slots).toEqual(before);
  });

  it('o reroll seguinte usa as chances do nível novo (com semente)', () => {
    const counts = (level: number) => {
      const rng = new Rng({ rngState: 777 });
      const total = { common: 0, uncommon: 0, rare: 0 };
      for (let i = 0; i < 4000; i++) {
        for (const id of newShop(rng, economyData, towerData, level, false).slots) {
          total[getTowerType(towerData, id).rarity!]++;
        }
      }
      return total;
    };
    const low = counts(1);
    const high = counts(5);
    expect(high.rare).toBeGreaterThan(low.rare * 3);
    expect(high.common).toBeLessThan(low.common);
    const n = 4000 * economyData.shop.slots;
    expect(high.rare / n).toBeCloseTo(0.3, 1);
  });

  it('rerolar depois de evoluir é determinístico e usa o nível novo', () => {
    const run = () => {
      const sim = shopSim('igual');
      sim.state.gold = 200;
      for (let i = 0; i < 4; i++) {
        sim.enqueue({ type: 'evolveNexus' });
        stepOnce(sim);
      }
      sim.enqueue({ type: 'rerollShop' });
      stepOnce(sim);
      return sim.state.shop.slots.join();
    };
    expect(run()).toBe(run());
  });
});

describe('save no meio da run', () => {
  it('guarda nível, vida máxima e vida do núcleo', () => {
    const sim = shopSim('save');
    sim.state.gold = 100;
    sim.state.nexus.hp = 10;
    for (let i = 0; i < 2; i++) {
      sim.enqueue({ type: 'evolveNexus' });
      stepOnce(sim);
    }
    const loaded = deserializeRunState(serializeRunState(sim.state));
    expect(loaded.nexus).toMatchObject({ level: 3, maxHp: 30, hp: 20 });
  });

  it('recusa nível fora da tabela ou vida máxima incoerente', () => {
    const sim = shopSim('save');
    const good = JSON.parse(serializeRunState(sim.state));
    const bad = (patch: object) => JSON.stringify({ ...good, nexus: { ...good.nexus, ...patch } });
    expect(() => deserializeRunState(bad({ level: 6 }))).toThrow(/Save inválido/);
    expect(() => deserializeRunState(bad({ level: 2 }))).toThrow(/Save inválido/);
    expect(() => deserializeRunState(bad({ hp: 21 }))).toThrow(/Save inválido/);
  });
});

describe('modelos da interface', () => {
  it('o slot avisa "limite" só quando a compra precisaria de casa nova', () => {
    const sim = shopSim('ui');
    place(sim, COMMON, 0);
    const [a, b] = distinctTypes();
    place(sim, a!, 1);
    place(sim, b!, 2);
    sim.state.shop.slots[0] = COMMON; // funde: sem aviso
    sim.state.shop.slots[1] = distinctTypes().find((t) => t !== a && t !== b)!; // precisa de casa
    sim.state.gold = 100;
    const model = buildShopModel(sim.state, null, economyData, towerData, classData);
    expect(model.slots[0]).toMatchObject({ fuseStar: 2, blockedByLimit: false });
    expect(model.slots[1]).toMatchObject({ fuseStar: null, blockedByLimit: true });
    // O aviso bate com a compra real.
    expect(buy(sim, 0).some((e) => e.type === 'towerBought')).toBe(true);
    expect(buy(sim, 1, freeCells(10)[9]!).some((e) => e.type === 'buyRefused')).toBe(true);
  });

  it('o painel do núcleo mostra nível, torres, chances atuais e do próximo nível', () => {
    const sim = shopSim('ui');
    place(sim, COMMON, 0);
    sim.state.gold = 25;
    const model = buildNexusPanelModel(sim.state, economyData);
    expect(model).toMatchObject({
      level: 1,
      maxLevel: 5,
      towers: 1,
      towerLimit: 3,
      nextTowerLimit: 4,
      cost: 20,
      canEvolve: true,
    });
    expect(model.chances).toEqual(economyData.shop.rarityChances[0]);
    expect(model.nextChances).toEqual(economyData.shop.rarityChances[1]);
  });

  it('no nível máximo não há próximo nível nem custo', () => {
    const sim = shopSim('ui');
    sim.state.nexus.level = 5;
    sim.state.gold = 999;
    const model = buildNexusPanelModel(sim.state, economyData);
    expect(model).toMatchObject({ cost: null, nextChances: null, nextTowerLimit: null });
    expect(model.canEvolve).toBe(false);
  });
});

describe('flash da fusão', () => {
  const merge = (towerId: number, stars: number, absorbedIds: number[]): SimEvent => ({
    type: 'towersMerged',
    tick: 1,
    towerId,
    towerType: COMMON,
    stars,
    x: towerId,
    y: 0,
    absorbedIds,
  });

  it('fusão simples: um flash', () => {
    expect(fusionFlashes([merge(1, 2, [])])).toEqual([{ towerId: 1, x: 1, y: 0 }]);
  });

  it('cascata: um flash só, na sobrevivente final', () => {
    expect(fusionFlashes([merge(1, 2, []), merge(2, 3, [1])])).toEqual([
      { towerId: 2, x: 2, y: 0 },
    ]);
  });
});
