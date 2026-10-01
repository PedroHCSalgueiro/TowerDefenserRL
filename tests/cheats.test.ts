import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import engineConfig from '../src/data/engine.json';
import { economyData } from '../src/sim/economy/economyData';
import { FixedStepClock } from '../src/sim/engine/clock';
import { Simulation, SimulationRunner } from '../src/sim/engine/simulation';
import { nexusData, nexusLevel } from '../src/sim/nexus/nexusData';
import { priceOf } from '../src/sim/shop/shop';
import { CHEAT_COMMAND_TYPES, type SimCommand } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { towerData } from '../src/sim/towers/towerData';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';
import { botBreak, botCells, botSim, playRun } from './support/waveBot';

const cell = freeCells(1)[0]!;

/** Um exemplo de cada comando de debug (trapaça). */
const cheats: SimCommand[] = [
  { type: 'spawnEnemy', enemyType: 'common' },
  { type: 'placeTower', towerType: 'mortar', x: cell.x, y: cell.y, star: 3 },
  { type: 'endWave' },
  { type: 'debugSpawnEnemies', count: 5, enemyType: null, layout: 'spread' },
  { type: 'debugSpawnTowers', count: 3, towerTypes: ['relay'], layout: 'clustered', star: 2 },
  { type: 'debugClear' },
  { type: 'debugSetStress', stress: { count: 10, layout: 'spread' } },
  { type: 'debugSetNexusInvulnerable', value: false },
  { type: 'debugSkipToWave', wave: 3 },
  { type: 'debugAddGold', amount: 500 },
  { type: 'debugSetInfiniteGold', value: false },
];

const playerCommands: SimCommand[] = [
  { type: 'buyTower', slot: 0, x: cell.x, y: cell.y },
  { type: 'rerollShop' },
  { type: 'sellTower', towerId: 999 },
  { type: 'moveTower', towerId: 999, x: 0, y: 0 },
  { type: 'evolveNexus' },
  { type: 'callWave' },
];

describe('marcação de run trapaceada', () => {
  it('a lista de trapaças tem um exemplo de cada comando de debug', () => {
    expect(new Set(cheats.map((c) => c.type))).toEqual(CHEAT_COMMAND_TYPES);
  });

  it('a run começa sem trapaça e os comandos do jogador não marcam', () => {
    const sim = shopSim('limpa');
    expect(sim.state.cheated).toBe(false);
    for (const command of playerCommands) sim.enqueue(command);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.state.cheated).toBe(false);
  });

  it.each(cheats.map((c) => [c.type, c] as const))('%s liga a marcação', (_type, command) => {
    const sim = shopSim('trapaca');
    sim.enqueue(command);
    sim.step();
    expect(sim.state.cheated).toBe(true);
  });

  it('liga mesmo quando a simulação recusa o comando (pular onda com onda ativa)', () => {
    const sim = shopSim('recusado');
    sim.enqueue({ type: 'callWave' });
    sim.step();
    const wave = sim.state.wave;
    sim.enqueue({ type: 'debugSkipToWave', wave: 5 });
    sim.step();
    expect(sim.state.wave).toBe(wave);
    expect(sim.state.cheated).toBe(true);
  });

  it('nunca volta a false: desligar a trapaça, jogar e atravessar o save', () => {
    const sim = shopSim('pra-sempre');
    sim.enqueue({ type: 'debugSetInfiniteGold', value: true });
    sim.step();
    sim.enqueue({ type: 'debugSetInfiniteGold', value: false });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 300; i++) sim.step();
    expect(sim.state.cheated).toBe(true);
    const restored = Simulation.restore(sim.serialize(), createGameSystems(realMap));
    expect(restored.state.cheated).toBe(true);
    expect(restored.state.debug.infiniteGold).toBe(false);
  });

  it('o save sem a marcação, sem o ouro infinito ou sem o ouro ganho é recusado', () => {
    const good = JSON.parse(shopSim('save').serialize()) as Record<string, unknown>;
    const noCheated = { ...good, cheated: undefined };
    const noInfinite = structuredClone(good) as { debug: Record<string, unknown> };
    delete noInfinite.debug.infiniteGold;
    const noEarned = structuredClone(good) as { stats: Record<string, unknown> };
    delete noEarned.stats.goldEarned;
    for (const bad of [noCheated, noInfinite, noEarned]) {
      expect(() => Simulation.restore(JSON.stringify(bad))).toThrow(/inválido/);
    }
    expect(() => Simulation.restore(JSON.stringify(good))).not.toThrow();
  });
});

describe('trapaças de ouro', () => {
  it(`"+${debugConfig.cheats.addGold} ouro" soma no saldo, mas não no ouro ganho da run`, () => {
    const sim = shopSim('mais-ouro');
    const gold = sim.state.gold;
    sim.enqueue({ type: 'debugAddGold', amount: debugConfig.cheats.addGold });
    const events = stepOnce(sim);
    expect(sim.state.gold).toBe(gold + debugConfig.cheats.addGold);
    expect(sim.state.stats.goldEarned).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'goldChanged', delta: debugConfig.cheats.addGold }),
    );
  });

  it('a quantidade fica presa entre 0 e maxGoldPerCommand', () => {
    const sim = shopSim('teto');
    const gold = sim.state.gold;
    sim.enqueue({ type: 'debugAddGold', amount: -50 });
    sim.enqueue({ type: 'debugAddGold', amount: Number.NaN });
    sim.step();
    expect(sim.state.gold).toBe(gold);
    sim.enqueue({ type: 'debugAddGold', amount: 1e12 });
    sim.step();
    expect(sim.state.gold).toBe(gold + debugConfig.maxGoldPerCommand);
  });

  it('ouro infinito: comprar, rerolar e evoluir não diminuem o ouro', () => {
    const sim = shopSim('infinito');
    sim.enqueue({ type: 'debugAddGold', amount: 500 });
    sim.enqueue({ type: 'debugSetInfiniteGold', value: true });
    sim.step();
    const gold = sim.state.gold;
    const slot = sim.state.shop.slots.findIndex((s) => s !== null);
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    sim.enqueue({ type: 'rerollShop' });
    sim.enqueue({ type: 'evolveNexus' });
    const events = stepOnce(sim);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['towerBought', 'shopChanged', 'nexusEvolved']),
    );
    expect(sim.state.towers).toHaveLength(1);
    expect(sim.state.nexus.level).toBe(economyData.nexusStartLevel + 1);
    expect(sim.state.gold).toBe(gold);
  });

  it('ouro infinito: a compra continua exigindo ouro ≥ preço', () => {
    const sim = shopSim('sem-ouro');
    sim.enqueue({ type: 'debugSetInfiniteGold', value: true });
    sim.step();
    sim.state.gold = 0;
    const slot = sim.state.shop.slots.findIndex((s) => s !== null);
    expect(priceOf(economyData, towerData, sim.state.shop.slots[slot]!)).toBeGreaterThan(0);
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    sim.enqueue({ type: 'rerollShop' });
    sim.enqueue({ type: 'evolveNexus' });
    sim.step();
    expect(sim.state.towers).toHaveLength(0);
    expect(sim.state.nexus.level).toBe(economyData.nexusStartLevel);
    expect(sim.state.gold).toBe(0);
  });

  it('desligar o ouro infinito volta a cobrar', () => {
    const sim = shopSim('desliga');
    sim.enqueue({ type: 'debugAddGold', amount: 100 });
    sim.enqueue({ type: 'debugSetInfiniteGold', value: true });
    sim.enqueue({ type: 'debugSetInfiniteGold', value: false });
    sim.step();
    const gold = sim.state.gold;
    sim.enqueue({ type: 'rerollShop' });
    sim.step();
    expect(sim.state.gold).toBe(gold - economyData.shop.rerollCost);
  });
});

describe('ouro ganho na run', () => {
  it('soma juros, bônus e abates; a venda fica de fora', () => {
    const sim = shopSim('ganho');
    sim.enqueue({ type: 'debugAddGold', amount: 40 });
    sim.step();
    const slot = sim.state.shop.slots.findIndex((s) => s !== null);
    sim.enqueue({ type: 'buyTower', slot, x: cell.x, y: cell.y });
    sim.step();
    const tower = sim.state.towers[0]!;
    sim.enqueue({ type: 'sellTower', towerId: tower.id });
    const sold = stepOnce(sim).find((e) => e.type === 'towerSold');
    expect(sold && sold.type === 'towerSold' && sold.refund).toBeGreaterThan(0);
    expect(sim.state.stats.goldEarned).toBe(0);
    // Fechar a onda pelo debug paga juros e bônus, e eles contam.
    const before = sim.state.gold;
    sim.enqueue({ type: 'endWave' });
    const ended = stepOnce(sim).find((e) => e.type === 'waveEnded');
    expect(ended?.type).toBe('waveEnded');
    if (ended?.type !== 'waveEnded') return;
    expect(ended.interest + ended.bonus).toBeGreaterThan(0);
    expect(sim.state.stats.goldEarned).toBe(ended.interest + ended.bonus);
    expect(sim.state.gold - before).toBe(ended.interest + ended.bonus);
  });

  it('numa run do bot: ouro final = inicial + ganho − gasto (abates, juros, bônus e antecipado)', () => {
    const sim = botSim('bot-ouro');
    let spent = 0;
    let killGoldSeen = false;
    playRun(sim, (s) => {
      botBreak(s);
      for (const event of s.drainEvents()) {
        if (event.type === 'towerBought') spent += event.price;
        else if (event.type === 'nexusEvolved') spent += event.cost;
        else if (event.type === 'shopChanged' && event.reason === 'reroll') {
          spent += economyData.shop.rerollCost;
        }
      }
      if (s.state.stats.kills > 0) killGoldSeen = true;
    });
    expect(killGoldSeen).toBe(true);
    expect(sim.state.cheated).toBe(false);
    expect(sim.state.stats.goldEarned).toBeGreaterThan(0);
    expect(sim.state.gold).toBe(economyData.startingGold + sim.state.stats.goldEarned - spent);
  });
});

describe('velocidade 5x e 10x (debug)', () => {
  it('o painel aceita 5x e 10x; o Q volta para 1x e não passa por elas', () => {
    const clock = new FixedStepClock(engineConfig);
    clock.setSpeed(10);
    expect(clock.speed).toBe(10);
    expect(clock.cycleSpeed()).toBe(1);
    expect([clock.cycleSpeed(), clock.cycleSpeed(), clock.cycleSpeed()]).toEqual([2, 3, 1]);
    clock.setSpeed(5);
    expect(clock.cycleSpeed()).toBe(1);
    expect(() => clock.setSpeed(7)).toThrow(RangeError);
  });

  it('5x e 10x dão o mesmo estado da referência e não marcam trapaça', () => {
    const TOTAL = 3000;
    const bestCell = botCells(realMap)[0]!;
    const plan = (sim: Simulation, done: Set<number>) => {
      const { tick } = sim.state;
      if (done.has(tick)) return;
      done.add(tick);
      if (tick === 0) {
        const slot = sim.state.shop.slots.findIndex((s) => s !== null);
        sim.enqueue({ type: 'buyTower', slot, ...bestCell });
      }
      if (tick % 600 === 0) sim.enqueue({ type: 'callWave' });
    };
    // Núcleo invulnerável direto no estado (sem comando de debug, para não marcar
    // trapaça): a run não termina antes do fim do teste.
    const create = () => {
      const sim = Simulation.create('rapido', createGameSystems(realMap));
      sim.state.debug.nexusInvulnerable = true;
      return sim;
    };
    const reference = create();
    const refDone = new Set<number>();
    while (reference.state.tick < TOTAL) {
      plan(reference, refDone);
      reference.step();
    }
    expect(reference.state.stats.kills).toBeGreaterThan(0);

    // Quadro de 1/30 s: em 5x e 10x os comandos caem em ticks múltiplos de 5 e 10,
    // e o plano usa só múltiplos de 600.
    const frame = 1000 / engineConfig.ticksPerSecond;
    for (const speed of engineConfig.debugSpeeds) {
      const runner = new SimulationRunner(create(), engineConfig);
      runner.clock.setSpeed(speed);
      const done = new Set<number>();
      while (runner.sim.state.tick < TOTAL) {
        plan(runner.sim, done);
        runner.update(frame);
      }
      expect(runner.sim.state.tick).toBe(TOTAL);
      expect(runner.clock.droppedTicks).toBe(0);
      expect(runner.sim.serialize()).toBe(reference.serialize());
      expect(runner.sim.state.cheated).toBe(false);
    }
  });
});

describe('dados das trapaças', () => {
  it('o +ouro do painel cabe no teto por comando', () => {
    expect(debugConfig.cheats.addGold).toBeLessThanOrEqual(debugConfig.maxGoldPerCommand);
  });

  it('o primeiro nível do núcleo custa menos que o ouro do teste de ouro infinito', () => {
    expect(nexusLevel(nexusData, economyData.nexusStartLevel + 1).cost).toBeLessThan(500);
  });
});
