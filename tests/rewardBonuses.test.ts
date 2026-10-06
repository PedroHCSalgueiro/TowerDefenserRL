/**
 * T24: o efeito de cada um dos 15 bônus das recompensas.
 */

import { describe, expect, it } from 'vitest';
import { areaDamageMultiplier, killWeight, reducedTriggerCount } from '../src/sim/classes/bonuses';
import { classData } from '../src/sim/classes/classData';
import { interestFor } from '../src/sim/economy/economy';
import { economyData } from '../src/sim/economy/economyData';
import { damageEnemy } from '../src/sim/enemies/damage';
import type { SimEvent } from '../src/sim/engine/events';
import { Rng } from '../src/sim/engine/rng';
import { Simulation } from '../src/sim/engine/simulation';
import { rewardMods } from '../src/sim/rewards/mods';
import { chainGoldAt } from '../src/sim/rewards/rewards';
import { chancesFor, newShop, priceOf } from '../src/sim/shop/shop';
import { createRunState, deserializeRunState, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { currentTowerLimit } from '../src/sim/towers/limit';
import { towerData } from '../src/sim/towers/towerData';
import { buildClassRows } from '../src/ui/classPanelModel';
import { purchasePreview } from '../src/ui/classPreview';
import { buildNexusPanelModel } from '../src/ui/nexusPanelModel';
import { buildShopModel } from '../src/ui/shopModel';
import { makeState, place, smallMap, testEnemies, testNexus, TPS } from './support/enemySim';
import { createNexusAttackSystem } from '../src/sim/nexus/systems';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';
import { addTower, run, towersOnly } from './support/towerSim';
import {
  armedType,
  factsAt,
  killFact,
  ofType,
  triggerData,
  triggerSim,
} from './support/triggerSim';

const types = towerData.types;

/** Põe o bônus direto na lista de escolhidos (efeitos lidos dos escolhidos). */
function take(state: RunState, id: string, classId: string | null = null, times = 1): void {
  for (let i = 0; i < times; i++) state.rewards.taken.push({ id, classId, wave: 5 });
}

/** Escolhe o bônus pela tela, como o jogador (efeitos de uma vez: vida e reroll grátis). */
function choose(sim: Simulation, id: string, classId: string | null = null): SimEvent[] {
  sim.state.rewards.screen = { wave: 5, options: [{ id, classId }], rerolls: 0, ticksLeft: 450 };
  sim.enqueue({ type: 'chooseReward', index: 0 });
  return stepOnce(sim);
}

describe('classe', () => {
  it('Artilharia pesada: +25% de dano em área por carta para torres Artilharia, junto com o bônus de classe', () => {
    const state = createRunState('art');
    expect(areaDamageMultiplier(classData, state, types.mortar!)).toBe(1);
    take(state, 'artilleryArea');
    expect(areaDamageMultiplier(classData, state, types.mortar!)).toBeCloseTo(1.25, 12);
    expect(areaDamageMultiplier(classData, state, types.reaper!)).toBeCloseTo(1.25, 12);
    take(state, 'artilleryArea');
    expect(areaDamageMultiplier(classData, state, types.mortar!)).toBeCloseTo(1.5, 12);
    // Classe da Artilharia no nível 4 (+25%): multiplica junto.
    state.classes.artillery!.level = 2;
    expect(areaDamageMultiplier(classData, state, types.mortar!)).toBeCloseTo(1.5 * 1.25, 12);
    // Torre sem Artilharia não ganha nada.
    expect(areaDamageMultiplier(classData, state, types.relay!)).toBe(1);
  });

  it('Artilharia pesada no tiro em área de verdade: a explosão tira 25% a mais', () => {
    const blast = (picks: number) => {
      const state = makeState();
      take(state, 'artilleryArea', null, picks);
      addTower(state, 'bomb', 0, 0);
      place(state, 'brick', 0, 0.4, 1000);
      const events = run(towersOnly(state), 4);
      return ofType(events, 'areaExploded')[0]!.damage;
    };
    expect(blast(0)).toBe(4);
    expect(blast(1)).toBe(5);
  });

  it('Engrenagens afiadas: "a cada N" das torres Mecânica −1 depois do bônus de classe, mínimo 2', () => {
    const state = createRunState('mec');
    take(state, 'mechanicalCount');
    expect(reducedTriggerCount(classData, state, types.mortar!, 5)).toBe(4);
    expect(reducedTriggerCount(classData, state, types.clock!, 10)).toBe(9);
    state.classes.mechanical!.level = 1; // −20%: 10 → 8 → 7
    expect(reducedTriggerCount(classData, state, types.clock!, 10)).toBe(7);
    state.classes.mechanical!.level = 2; // −40%: 5 → 3 → 2; 4 → 2 → mínimo 2
    expect(reducedTriggerCount(classData, state, types.mortar!, 5)).toBe(2);
    expect(reducedTriggerCount(classData, state, types.mortar!, 4)).toBe(2);
    // Sem Mecânica, nada muda.
    expect(reducedTriggerCount(classData, state, types.reaper!, 5)).toBe(5);
  });

  it('Fluxo arcano: a trava de ativação de todas as torres cai de 1 s para 0,7 s', () => {
    const lock = (withReward: boolean) => {
      const state = makeState();
      if (withReward) take(state, 'arcaneLock');
      addTower(state, 'relay', 0, 0);
      const neighbor = addTower(state, 'arrow', 1, 0);
      place(state, 'brick', 0.5, 0.5, 1e9);
      const events = run(triggerSim(state), 1);
      const activated = ofType(events, 'towerActivated').find((e) => e.towerId === neighbor.id)!;
      return neighbor.activationReadyTick - activated.tick;
    };
    // A 8 ticks/s: 1 s = 8 ticks, 0,7 s = 5,6 → 6 ticks.
    expect(lock(false)).toBe(8);
    expect(lock(true)).toBe(6);
  });

  it('Colheita sombria: morte de elite ou chefão vale ×3 para torres Sombria, depois do teto 4', () => {
    const state = createRunState('sombria');
    const shadow = types.clock!; // Mecânica e Sombria
    expect(killWeight(classData, state, shadow, null, 1, true)).toBe(1);
    take(state, 'shadowElite');
    expect(killWeight(classData, state, shadow, null, 1, true)).toBe(3);
    expect(killWeight(classData, state, shadow, null, 1, false)).toBe(1);
    // Torre sem Sombria não ganha nada.
    expect(killWeight(classData, state, types.relay!, null, 1, true)).toBe(1);
    // Classe Sombria nível 4 (toda morte ×2): 1 → 2 → ×3 = 6; abate duplo: 2 → 4 (teto) → ×3 = 12.
    state.classes.shadow!.level = 2;
    expect(killWeight(classData, state, shadow, null, 1, true)).toBe(6);
    expect(killWeight(classData, state, shadow, null, 2, true)).toBe(12);
    expect(killWeight(classData, state, shadow, null, 2, false)).toBe(4);
  });

  it('Colheita sombria no motor: o contador de uma torre Sombria anda 3 numa morte de elite', () => {
    const counter = armedType(
      'everyNKillsInRange',
      'explosion',
      { kills: 10, radius: 0.5, damagePercent: 100 },
      { classes: ['shadow', 'arcane'] },
    );
    const data = { ...triggerData(), types: { ...triggerData().types, counter } };
    const counterAfter = (elite: boolean) => {
      const state = makeState();
      take(state, 'shadowElite');
      const tower = addTower(state, 'counter', 0, 0);
      tower.cooldownTicks = 1e6;
      run(triggerSim(state, data, [factsAt(1, [killFact(0.5, 0, null, 1, 9999, elite)])]), 1);
      return tower.triggerCounter;
    };
    expect(counterAfter(false)).toBe(1);
    expect(counterAfter(true)).toBe(3);
  });

  it('a morte de um elite sai com elite no enemyKilled', () => {
    const state = makeState();
    const enemy = place(state, 'walker', 0, 1, 5);
    enemy.elite = true;
    const sim = new Simulation(state, [
      (ctx) => {
        if (enemy.active) damageEnemy(ctx, testEnemies, enemy, 100, null);
      },
    ]);
    sim.step();
    expect(sim.drainEvents()).toEqual([
      expect.objectContaining({ type: 'enemyKilled', elite: true }),
    ]);
  });

  it('Coringa: a classe da carta conta +1 torre no bônus de classe, no painel e na prévia da loja', () => {
    const sim = shopSim('coringa');
    const [cell] = freeCells(1);
    sim.enqueue({ type: 'placeTower', towerType: 'relay', x: cell!.x, y: cell!.y });
    stepOnce(sim);
    expect(sim.state.classes.arcane!.level).toBe(0);
    const events = choose(sim, 'classWildcard', 'arcane');
    // O sistema de classes roda também congelado: o nível sobe no mesmo tick da escolha.
    expect(sim.state.classes.arcane!.level).toBe(1);
    expect(ofType(events, 'classLevelChanged')).toEqual([
      expect.objectContaining({ classId: 'arcane', level: 1, count: 2 }),
    ]);
    expect(sim.state.classes.mechanical!.level).toBe(0);
    const wildcards = rewardMods(sim.state).wildcards;
    const row = buildClassRows(sim.state.classes, classData, towerData, wildcards).find(
      (r) => r.id === 'arcane',
    )!;
    expect(row.count).toBe(2);
    expect(row.members).toEqual(['Relé', 'Coringa']);
    // Prévia na loja: o Obelisco (Arcana e Sombria) leva a Arcana a 3.
    expect(
      purchasePreview(sim.state.towers, 'obelisk', towerData, classData, wildcards)!.classes[0],
    ).toBe('Arcana 2/4 → 3/4');
  });
});

describe('economia', () => {
  const closeWithGold = (gold: number, picks: string[]) => {
    const sim = shopSim('economia');
    for (const id of picks) take(sim.state as RunState, id);
    (sim.state as RunState).gold = gold;
    sim.enqueue({ type: 'endWave' });
    return ofType(stepOnce(sim), 'waveEnded')[0]!;
  };

  it('Cofre maior: teto dos juros 15', () => {
    expect(closeWithGold(200, []).interest).toBe(10);
    expect(closeWithGold(200, ['interestCap']).interest).toBe(15);
    expect(closeWithGold(120, ['interestCap']).interest).toBe(12);
    expect(interestFor(economyData, 500, 15)).toBe(15);
  });

  it('Renda extra: +3 de renda por onda, por carta (conta no ouro ganho)', () => {
    expect(closeWithGold(0, []).bonus).toBe(16);
    expect(closeWithGold(0, ['income']).bonus).toBe(19);
    const twice = closeWithGold(0, ['income', 'income']);
    expect(twice.bonus).toBe(22);
  });

  it('Reroll grátis: 1 por loja, já na loja aberta; não acumula', () => {
    const sim = shopSim('reroll-gratis');
    const state = sim.state as RunState;
    state.gold = 20;
    choose(sim, 'freeReroll');
    expect(state.shop.freeRerolls).toBe(1);
    expect(buildShopModel(state, null, economyData, towerData, classData).rerollCost).toBe(0);
    sim.enqueue({ type: 'rerollShop' });
    stepOnce(sim);
    expect(state.gold).toBe(20);
    expect(state.shop.freeRerolls).toBe(0);
    sim.enqueue({ type: 'rerollShop' });
    stepOnce(sim);
    expect(state.gold).toBe(20 - economyData.shop.rerollCost);
    // Loja nova no fim da onda: 1 de novo, e sem usar não vira 2.
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(state.shop.freeRerolls).toBe(1);
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(state.shop.freeRerolls).toBe(1);
  });

  it('Desconto: torres 15% mais baratas, arredondado para o mais próximo (9, 13, 21); o investido é o preço pago', () => {
    expect(priceOf(economyData, towerData, 'mortar', 15)).toBe(9);
    expect(priceOf(economyData, towerData, 'obelisk', 15)).toBe(13);
    expect(priceOf(economyData, towerData, 'mirror', 15)).toBe(21);
    const sim = shopSim('desconto');
    const state = sim.state as RunState;
    take(state, 'discount');
    state.gold = 100;
    state.shop.slots = ['mortar', 'mortar', 'obelisk', null, null];
    const [a] = freeCells(1);
    expect(buildShopModel(state, null, economyData, towerData, classData).slots[0]!.price).toBe(9);
    sim.enqueue({ type: 'buyTower', slot: 0, x: a!.x, y: a!.y });
    stepOnce(sim);
    expect(state.gold).toBe(91);
    expect(state.towers[0]!.invested).toBe(9);
    // A fusão soma o preço pago (com desconto).
    sim.enqueue({ type: 'buyTower', slot: 1 });
    stepOnce(sim);
    expect(state.towers[0]!.invested).toBe(18);
  });

  it('Revenda cheia: vender devolve 100% do investido', () => {
    const sell = (picks: string[]) => {
      const sim = shopSim('revenda');
      const state = sim.state as RunState;
      for (const id of picks) take(state, id);
      state.gold = 100;
      state.shop.slots = ['obelisk', null, null, null, null];
      const [a] = freeCells(1);
      sim.enqueue({ type: 'buyTower', slot: 0, x: a!.x, y: a!.y });
      stepOnce(sim);
      sim.enqueue({ type: 'sellTower', towerId: state.towers[0]!.id });
      return ofType(stepOnce(sim), 'towerSold')[0]!.refund;
    };
    expect(sell([])).toBe(10); // 70% de 15
    expect(sell(['fullRefund'])).toBe(15);
    expect(sell(['fullRefund', 'discount'])).toBe(13);
  });
});

describe('núcleo', () => {
  it('Mais espaço: +1 no limite de torres por carta', () => {
    const state = createRunState('limite');
    expect(currentTowerLimit(state)).toBe(3);
    take(state, 'towerLimit');
    expect(currentTowerLimit(state)).toBe(4);
    take(state, 'towerLimit');
    expect(currentTowerLimit(state)).toBe(5);
    const sim = shopSim('limite-compra');
    const s = sim.state as RunState;
    take(s, 'towerLimit');
    s.gold = 100;
    const cells = freeCells(4);
    for (const [i, type] of ['mortar', 'reaper', 'relay', 'obelisk'].entries()) {
      s.shop.slots = [type, null, null, null, null];
      sim.enqueue({ type: 'buyTower', slot: 0, ...cells[i]! });
      stepOnce(sim);
    }
    expect(s.towers).toHaveLength(4);
    expect(buildNexusPanelModel(s, economyData).towerLimit).toBe(4);
  });

  it('Núcleo reforçado: +15 de vida máxima e cura total; evoluir mantém os +15; o save aceita', () => {
    const sim = shopSim('vida');
    const state = sim.state as RunState;
    state.nexus.hp = 5;
    choose(sim, 'nexusHp');
    expect(state.nexus.maxHp).toBe(35);
    expect(state.nexus.hp).toBe(35);
    state.gold = 100;
    sim.enqueue({ type: 'evolveNexus' });
    stepOnce(sim);
    expect(state.nexus.maxHp).toBe(25 + 15);
    expect(state.nexus.hp).toBe(40);
    choose(sim, 'nexusHp');
    expect(state.nexus.maxHp).toBe(55);
    expect(() => deserializeRunState(sim.serialize())).not.toThrow();
    // Vida máxima sem os bônus que a explicam: save recusado.
    const bad = JSON.parse(sim.serialize()) as RunState;
    bad.rewards.taken = [];
    expect(() => deserializeRunState(JSON.stringify(bad))).toThrow(/inválido/);
  });

  it('Núcleo armado: dano do ataque do núcleo ×3', () => {
    const hit = (withReward: boolean) => {
      const state = makeState('armado', testNexus);
      if (withReward) take(state, 'nexusDamage');
      const enemy = place(state, 'brick', 1, 2, 100);
      run(
        new Simulation(state, [
          createNexusAttackSystem(smallMap.nexus, testEnemies, testNexus, TPS),
        ]),
        1,
      );
      return 100 - enemy.hp;
    };
    expect(hit(false)).toBe(4);
    expect(hit(true)).toBe(12);
  });

  it('Loja melhor: a loja sorteia com as chances de um nível acima (preso ao último)', () => {
    const sim = shopSim('raridade');
    const state = sim.state as RunState;
    take(state, 'shopRarity');
    const expected = newShop(
      new Rng({ rngState: state.rngState }),
      economyData,
      towerData,
      2,
      false,
    );
    sim.enqueue({ type: 'endWave' });
    stepOnce(sim);
    expect(state.shop.slots).toEqual(expected.slots);
    expect(buildNexusPanelModel(state, economyData).chances).toEqual(chancesFor(economyData, 2));
    expect(buildNexusPanelModel(state, economyData).nextChances).toEqual(
      chancesFor(economyData, 3),
    );
  });
});

describe('cadeia', () => {
  it('Cadeia lucrativa: +1 de ouro em x10, x20, x30...', () => {
    const state = createRunState('cadeia');
    expect(chainGoldAt(state, 10)).toBe(0);
    take(state, 'chainGold');
    expect([9, 10, 11, 19, 20, 30].map((n) => chainGoldAt(state, n))).toEqual([0, 1, 0, 0, 1, 1]);
  });

  it('no motor: a cadeia de 12 gatilhos visíveis rende 1 de ouro, no ouro ganho', () => {
    const chain = (withReward: boolean) => {
      const state = makeState();
      if (withReward) take(state, 'chainGold');
      const line = Array.from({ length: 14 }, (_, x) => addTower(state, 'echo', x, 0));
      for (const tower of line) tower.cooldownTicks = 1e6;
      const fact: SimEvent = {
        type: 'towerActivated',
        tick: 0,
        towerId: line[0]!.id,
        sourceTowerId: 999,
        depth: 1,
      };
      const events = run(triggerSim(state, triggerData(), [factsAt(1, [fact])]), 6);
      return { state, events };
    };
    const plain = chain(false);
    expect(plain.state.stats.longestChain).toBeGreaterThanOrEqual(10);
    expect(plain.state.stats.chainGold).toBe(0);
    const paid = chain(true);
    const expected = Math.floor(paid.state.stats.longestChain / 10);
    expect(paid.state.stats.longestChain).toBe(plain.state.stats.longestChain);
    expect(paid.state.stats.chainGold).toBe(expected);
    expect(paid.state.gold).toBe(plain.state.gold + expected);
    expect(paid.state.stats.goldEarned).toBe(plain.state.stats.goldEarned + expected);
    expect(ofType(paid.events, 'chainGold').map((e) => e.chainLength)).toEqual(
      Array.from({ length: expected }, (_, i) => (i + 1) * 10),
    );
  });
});

describe('o jogo de verdade', () => {
  it('uma run com os bônus escolhidos continua determinística', () => {
    const play = () => {
      const sim = Simulation.create('det-bonus', createGameSystems(realMap));
      sim.enqueue({ type: 'debugSkipToWave', wave: 21 });
      for (let i = 0; i < 2000; i++) {
        if (sim.state.rewards.screen) sim.enqueue({ type: 'chooseReward', index: i % 3 });
        sim.step();
      }
      return sim.serialize();
    };
    expect(play()).toBe(play());
  });
});
