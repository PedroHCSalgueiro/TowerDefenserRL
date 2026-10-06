/**
 * T24: recompensas de escolha. Regras da tela: dados, abertura ao fechar as
 * ondas, sorteio (determinístico, sem repetir, sem não repetíveis já
 * escolhidos, sem bônus que não podem mais ter efeito), reroll, tempo
 * esgotado, pausa, fila de telas, RNG separado da loja e save.
 */

import { describe, expect, it } from 'vitest';
import rewardsJson from '../src/data/rewards.json';
import engineConfig from '../src/data/engine.json';
import renderConfig from '../src/data/render.json';
import uiConfig from '../src/data/ui.json';
import { classData } from '../src/sim/classes/classData';
import { damageEnemy } from '../src/sim/enemies/damage';
import type { EnemyData } from '../src/sim/enemies/enemyData';
import type { SimEvent } from '../src/sim/engine/events';
import { Rng } from '../src/sim/engine/rng';
import { Simulation, SimulationRunner, type System } from '../src/sim/engine/simulation';
import { loadRewardData, rewardData, type RewardData } from '../src/sim/rewards/rewardData';
import {
  availableRewards,
  chooseTicks,
  drawRewardOptions,
  freeWildcardClasses,
} from '../src/sim/rewards/rewards';
import { createRewardsState } from '../src/sim/rewards/rewardState';
import {
  createRunState,
  deserializeRunState,
  RUN_STATE_VERSION,
  type RunState,
} from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import type { WaveData } from '../src/sim/waves/waveData';
import { blindNexus, makeState, smallMap, testEnemies, TPS } from './support/enemySim';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';
import { noRewards } from './support/waveBot';
import { goodBotReserve, goodBotReward, REWARD_PRIORITY } from './support/goodBot';
import { buildRewardScreenModel } from '../src/ui/rewardScreenModel';

const CHOOSE_TICKS = chooseTicks(rewardData, engineConfig.ticksPerSecond);

function ofType<K extends SimEvent['type']>(events: SimEvent[], type: K) {
  return events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
}

/** Fecha as ondas até a 5 (pelo "Pular para onda" do debug): abre a tela da onda 5. */
function atWave5Screen(seed: string, rewards: RewardData = rewardData): Simulation {
  const sim = Simulation.create(seed, createGameSystems(realMap, { rewards }));
  sim.enqueue({ type: 'debugSkipToWave', wave: 6 });
  stepOnce(sim);
  return sim;
}

function ids(sim: Simulation): string[] {
  return sim.state.rewards.screen!.options.map((o) => o.id);
}

describe('dados das recompensas', () => {
  it('ondas 5 a 35, 3 cartas, 15 s e reroll 5 + 5 por reroll, todos nos dados', () => {
    expect(rewardData.waves).toEqual([5, 10, 15, 20, 25, 30, 35]);
    expect(rewardData.choices).toBe(3);
    expect(rewardData.chooseSeconds).toBe(15);
    expect(rewardData.reroll).toEqual({ baseCost: 5, costStep: 5 });
    expect(CHOOSE_TICKS).toBe(450);
  });

  it('os 15 bônus iniciais: 4 repetíveis, categorias e classes', () => {
    expect(rewardData.rewards).toHaveLength(15);
    expect(rewardData.rewards.filter((r) => r.repeatable).map((r) => r.id)).toEqual([
      'artilleryArea',
      'income',
      'towerLimit',
      'nexusHp',
    ]);
    const byCategory = (c: string) =>
      rewardData.rewards.filter((r) => r.category === c).map((r) => r.id);
    expect(byCategory('class')).toHaveLength(5);
    expect(byCategory('economy')).toHaveLength(5);
    expect(byCategory('nexus')).toHaveLength(4);
    expect(byCategory('chain')).toEqual(['chainGold']);
    // Por classe, economia ou núcleo, nunca por torre: as classes vêm dos dados das classes.
    for (const r of rewardData.rewards) {
      if (r.classId !== null) expect(classData.ids).toContain(r.classId);
    }
  });

  it('o carregamento recusa efeito desconhecido, efeito de classe sem classe e coringa com classe', () => {
    const base = structuredClone(rewardsJson) as Record<string, unknown> & {
      rewards: Record<string, Record<string, unknown>>;
    };
    const broken = (edit: (raw: typeof base) => void) => {
      const raw = structuredClone(base);
      edit(raw);
      return () => loadRewardData(raw);
    };
    expect(broken(() => {})).not.toThrow();
    expect(
      broken((r) => {
        r.rewards.income!.effect = { kind: 'nada' };
      }),
    ).toThrow(/effect.kind/);
    expect(
      broken((r) => {
        delete r.rewards.artilleryArea!.classId;
      }),
    ).toThrow(/classId/);
    expect(
      broken((r) => {
        r.rewards.classWildcard!.classId = 'arcane';
      }),
    ).toThrow(/coringa/);
    expect(
      broken((r) => {
        r.waves = [10, 5];
      }),
    ).toThrow(/ordem/);
  });
});

describe('abertura da tela', () => {
  it('fechar a onda 5 abre a tela com 3 cartas diferentes; as ondas 1 a 4 não', () => {
    const sim = Simulation.create('abre', createGameSystems(realMap));
    sim.enqueue({ type: 'debugSkipToWave', wave: 5 });
    stepOnce(sim);
    expect(sim.state.wave).toBe(4);
    expect(sim.state.rewards.screen).toBeNull();
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    const opened = ofType(events, 'rewardOpened');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ wave: 5, queued: 0 });
    expect(new Set(ids(sim)).size).toBe(3);
  });

  it('sem recompensas nos dados (lista de ondas vazia), nenhuma tela abre', () => {
    const sim = atWave5Screen('sem', noRewards);
    expect(sim.state.wave).toBe(5);
    expect(sim.state.rewards.screen).toBeNull();
  });

  it('o botão do debug abre uma tela extra na hora e marca a run como trapaceada', () => {
    const sim = shopSim('debug-recompensa');
    sim.enqueue({ type: 'debugOpenReward' });
    const events = stepOnce(sim);
    expect(ofType(events, 'rewardOpened')[0]).toMatchObject({ wave: 0 });
    expect(sim.state.cheated).toBe(true);
    // Com a tela aberta, outra vai para a fila.
    sim.enqueue({ type: 'debugOpenReward' });
    stepOnce(sim);
    expect(sim.state.rewards.queue).toEqual([0]);
  });
});

describe('sorteio', () => {
  it('é determinístico: a mesma semente dá as mesmas cartas', () => {
    expect(ids(atWave5Screen('det'))).toEqual(ids(atWave5Screen('det')));
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(new Set(seeds.map((s) => ids(atWave5Screen(s)).join(','))).size).toBeGreaterThan(1);
  });

  it('nunca repete carta na mesma tela', () => {
    const state = createRunState('sem-repetir');
    const rng = new Rng(state.rewards);
    for (let i = 0; i < 300; i++) {
      const options = drawRewardOptions(rng, state);
      expect(options).toHaveLength(3);
      expect(new Set(options.map((o) => o.id)).size).toBe(3);
    }
  });

  it('todos os disponíveis saem com chance igual (300 sorteios de 3 entre 15)', () => {
    const state = createRunState('chances');
    const rng = new Rng(state.rewards);
    const counts = new Map<string, number>();
    const draws = 3000;
    for (let i = 0; i < draws; i++) {
      for (const o of drawRewardOptions(rng, state)) counts.set(o.id, (counts.get(o.id) ?? 0) + 1);
    }
    const expected = (draws * 3) / 15;
    for (const r of rewardData.rewards) {
      expect(counts.get(r.id) ?? 0).toBeGreaterThan(expected * 0.85);
      expect(counts.get(r.id) ?? 0).toBeLessThan(expected * 1.15);
    }
  });

  it('não repetível escolhido sai do sorteio; repetível continua', () => {
    const state = createRunState('nao-repete');
    state.rewards.taken.push(
      { id: 'discount', classId: null, wave: 5 },
      { id: 'towerLimit', classId: null, wave: 10 },
    );
    const available = availableRewards(state).map((r) => r.id);
    expect(available).not.toContain('discount');
    expect(available).toContain('towerLimit');
    const rng = new Rng(state.rewards);
    for (let i = 0; i < 200; i++) {
      expect(drawRewardOptions(rng, state).map((o) => o.id)).not.toContain('discount');
    }
  });

  it('coringa: a classe vem sorteada, uma vez por classe; sem classe livre, sai do sorteio', () => {
    const state = createRunState('coringa');
    const wildcard = rewardData.byId.get('classWildcard')!;
    const rng = new Rng(state.rewards);
    for (let i = 0; i < 100; i++) {
      for (const o of drawRewardOptions(rng, state)) {
        if (o.id === 'classWildcard') expect(classData.ids).toContain(o.classId);
        else expect(o.classId).toBeNull();
      }
    }
    state.rewards.taken.push({ id: 'classWildcard', classId: 'arcane', wave: 5 });
    expect(freeWildcardClasses(state, wildcard)).toEqual(['artillery', 'mechanical', 'shadow']);
    for (let i = 0; i < 200; i++) {
      const o = drawRewardOptions(rng, state).find((x) => x.id === 'classWildcard');
      if (o) expect(o.classId).not.toBe('arcane');
    }
    for (const classId of ['artillery', 'mechanical', 'shadow']) {
      state.rewards.taken.push({ id: 'classWildcard', classId, wave: 10 });
    }
    expect(availableRewards(state).map((r) => r.id)).not.toContain('classWildcard');
  });

  it('bônus sem efeito fica fora: raridade de nível acima com o núcleo no 5 ou mais', () => {
    const state = createRunState('raridade');
    state.nexus.level = 4;
    expect(availableRewards(state).map((r) => r.id)).toContain('shopRarity');
    for (const level of [5, 6, 9]) {
      state.nexus.level = level;
      expect(availableRewards(state).map((r) => r.id)).not.toContain('shopRarity');
    }
  });

  it('com menos de 3 disponíveis, mostra os que houver', () => {
    const tiny: RewardData = {
      ...rewardData,
      rewards: rewardData.rewards.filter((r) => ['discount', 'income'].includes(r.id)),
    };
    const state = createRunState('poucos');
    expect(drawRewardOptions(new Rng(state.rewards), state, tiny)).toHaveLength(2);
  });

  it('RNG separado: sortear e rerolar cartas não muda as lojas da run', () => {
    const shops = (rewards: RewardData) => {
      const sim = Simulation.create('lojas', createGameSystems(realMap, { rewards }));
      sim.enqueue({ type: 'debugSkipToWave', wave: 6 });
      stepOnce(sim);
      if (sim.state.rewards.screen) {
        sim.enqueue({ type: 'debugAddGold', amount: 100 });
        sim.enqueue({ type: 'rerollRewards' });
        sim.enqueue({ type: 'rerollRewards' });
        sim.enqueue({ type: 'chooseReward', index: 0 });
        stepOnce(sim);
      }
      const seen = [sim.state.shop.slots.join(',')];
      sim.enqueue({ type: 'debugAddGold', amount: 100 });
      sim.enqueue({ type: 'rerollShop' });
      stepOnce(sim);
      seen.push(sim.state.shop.slots.join(','));
      return { seen, rngState: sim.state.rngState };
    };
    const without = shops(noRewards);
    const withRewards = shops(rewardData);
    expect(withRewards).toEqual(without);
  });

  it('o RNG das cartas sai da semente e é diferente do RNG da simulação', () => {
    const state = createRunState('fluxo');
    expect(state.rewards.rngState).toBe(createRewardsState('fluxo').rngState);
    expect(state.rewards.rngState).not.toBe(createRunState('fluxo').rngState);
    expect(createRewardsState('outra').rngState).not.toBe(state.rewards.rngState);
  });
});

describe('reroll das cartas', () => {
  it('custa 5, 10, 15 e volta a 5 na tela seguinte; troca as cartas sem repetir as da tela', () => {
    const sim = atWave5Screen('reroll');
    sim.enqueue({ type: 'debugAddGold', amount: 100 });
    stepOnce(sim);
    const costs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = ids(sim);
      const gold = sim.state.gold;
      sim.enqueue({ type: 'rerollRewards' });
      const event = ofType(stepOnce(sim), 'rewardRerolled')[0]!;
      costs.push(event.cost);
      expect(sim.state.gold).toBe(gold - event.cost);
      expect(ids(sim).some((id) => before.includes(id))).toBe(false);
    }
    expect(costs).toEqual([5, 10, 15]);
    expect(sim.state.stats.rewardRerollGold).toBe(30);
    sim.enqueue({ type: 'chooseReward', index: 0 });
    sim.enqueue({ type: 'debugOpenReward' });
    stepOnce(sim);
    sim.enqueue({ type: 'rerollRewards' });
    expect(ofType(stepOnce(sim), 'rewardRerolled')[0]!.cost).toBe(5);
  });

  it('sem ouro, recusado; com o ouro infinito, precisa ter o custo mas não gasta', () => {
    const sim = atWave5Screen('reroll-ouro');
    sim.state.gold = 4;
    const before = ids(sim);
    sim.enqueue({ type: 'rerollRewards' });
    expect(ofType(stepOnce(sim), 'rewardRerolled')).toHaveLength(0);
    expect(ids(sim)).toEqual(before);
    sim.state.gold = 5;
    sim.enqueue({ type: 'debugSetInfiniteGold', value: true });
    sim.enqueue({ type: 'rerollRewards' });
    sim.enqueue({ type: 'rerollRewards' });
    const events = stepOnce(sim);
    // O segundo custa 10: com 5 de ouro, nem o ouro infinito paga.
    expect(ofType(events, 'rewardRerolled').map((e) => e.cost)).toEqual([5]);
    expect(sim.state.gold).toBe(5);
    expect(sim.state.stats.rewardRerollGold).toBe(0);
  });

  it('reiniciar o tempo da tela', () => {
    const sim = atWave5Screen('reroll-tempo');
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.state.rewards.screen!.ticksLeft).toBe(CHOOSE_TICKS - 100);
    sim.state.gold = 50;
    sim.enqueue({ type: 'rerollRewards' });
    sim.step();
    expect(sim.state.rewards.screen!.ticksLeft).toBe(CHOOSE_TICKS);
  });
});

describe('escolha e tempo esgotado', () => {
  it('escolher põe o bônus na run, fecha a tela e devolve o jogo; índice inválido é ignorado', () => {
    const sim = atWave5Screen('escolhe');
    const option = sim.state.rewards.screen!.options[1]!;
    sim.enqueue({ type: 'chooseReward', index: 7 });
    sim.enqueue({ type: 'chooseReward', index: -1 });
    stepOnce(sim);
    expect(sim.state.rewards.screen).not.toBeNull();
    sim.enqueue({ type: 'chooseReward', index: 1 });
    const chosen = ofType(stepOnce(sim), 'rewardChosen');
    expect(chosen).toEqual([
      expect.objectContaining({
        wave: 5,
        rewardId: option.id,
        classId: option.classId,
        auto: false,
      }),
    ]);
    expect(sim.state.rewards.taken).toEqual([{ id: option.id, classId: option.classId, wave: 5 }]);
    expect(sim.state.rewards.screen).toBeNull();
  });

  it('com o tempo esgotado, a simulação escolhe uma das 3 pelo RNG das cartas (determinístico)', () => {
    const run = () => {
      const sim = atWave5Screen('tempo');
      const options = ids(sim);
      const events: SimEvent[] = [];
      for (let i = 0; i < CHOOSE_TICKS - 1; i++) events.push(...stepOnce(sim));
      expect(sim.state.rewards.screen).not.toBeNull();
      events.push(...stepOnce(sim));
      expect(sim.state.rewards.screen).toBeNull();
      const chosen = ofType(events, 'rewardChosen');
      expect(chosen).toHaveLength(1);
      expect(chosen[0]!.auto).toBe(true);
      expect(options).toContain(chosen[0]!.rewardId);
      return sim.serialize();
    };
    expect(run()).toBe(run());
  });

  it('a escolha do jogador no último tick vale (antes do tempo esgotado)', () => {
    const sim = atWave5Screen('ultimo-tick');
    for (let i = 0; i < CHOOSE_TICKS - 1; i++) sim.step();
    const option = sim.state.rewards.screen!.options[2]!;
    sim.enqueue({ type: 'chooseReward', index: 2 });
    const chosen = ofType(stepOnce(sim), 'rewardChosen');
    expect(chosen).toEqual([expect.objectContaining({ rewardId: option.id, auto: false })]);
  });
});

describe('pausa', () => {
  it('com a tela aberta o tick não anda, os inimigos param e as ações do jogo são ignoradas', () => {
    const sim = shopSim('pausa-recompensa');
    const [cell] = freeCells(1);
    sim.enqueue({ type: 'debugAddGold', amount: 200 });
    sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 120; i++) sim.step();
    sim.enqueue({ type: 'debugOpenReward' });
    sim.step();
    expect(sim.state.rewards.screen).not.toBeNull();
    const tick = sim.state.tick;
    const before = JSON.parse(sim.serialize()) as ReturnType<typeof createRunState>;
    for (const command of [
      { type: 'buyTower', slot: 0, x: cell!.x, y: cell!.y },
      { type: 'rerollShop' },
      { type: 'sellTower', towerId: 1 },
      { type: 'moveTower', towerId: 1, x: 0, y: 0 },
      { type: 'evolveNexus' },
      { type: 'callWave' },
      { type: 'endWave' },
      { type: 'debugSkipToWave', wave: 10 },
    ] as const) {
      sim.enqueue(command);
    }
    for (let i = 0; i < 30; i++) sim.step();
    const after = JSON.parse(sim.serialize()) as typeof before;
    expect(sim.state.tick).toBe(tick);
    expect(after.enemies).toEqual(before.enemies);
    expect(after.projectiles).toEqual(before.projectiles);
    expect(after.towers).toEqual(before.towers);
    expect(after.shop).toEqual(before.shop);
    expect(after.gold).toBe(before.gold);
    expect(after.nexus).toEqual(before.nexus);
    expect(after.waves).toEqual(before.waves);
    expect(after.wave).toBe(before.wave);
    expect(after.commandQueue).toEqual([]);
    // Só o tempo da tela andou.
    expect(after.rewards.screen!.ticksLeft).toBe(before.rewards.screen!.ticksLeft - 30);
    // Escolher devolve o jogo: o tick volta a andar e os inimigos a se mover.
    sim.enqueue({ type: 'chooseReward', index: 0 });
    sim.step();
    expect(sim.state.tick).toBe(tick);
    sim.step();
    expect(sim.state.tick).toBe(tick + 1);
  });

  it('no relógio do jogo, a tela anda em 1x mesmo em 3x (15 s de verdade)', () => {
    const runner = new SimulationRunner(atWave5Screen('relogio'));
    runner.clock.setSpeed(3);
    const frame = 1000 / engineConfig.ticksPerSecond;
    for (let i = 0; i < 30; i++) runner.update(frame);
    expect(runner.sim.state.rewards.screen!.ticksLeft).toBe(CHOOSE_TICKS - 30);
    expect(runner.clock.speed).toBe(3);
    // A tela fecha: volta aos 3x.
    runner.sim.enqueue({ type: 'chooseReward', index: 0 });
    runner.update(frame);
    const tick = runner.sim.state.tick;
    for (let i = 0; i < 10; i++) runner.update(frame);
    expect(runner.sim.state.tick).toBe(tick + 30);
  });
});

/** Inimigos lentos (28 s para atravessar o mapa pequeno), para empilhar ondas. */
const slowEnemies: EnemyData = {
  ...testEnemies,
  types: {
    ...testEnemies.types,
    slow: {
      hp: 10,
      speed: 0.25,
      armor: 0,
      nexusDamage: 1,
      gold: 0,
      movement: 'ground',
      boss: false,
    },
  },
};

const oneSlow = {
  hpMultiplier: 1,
  spawnSeconds: 0.25,
  enemies: [{ type: 'slow', count: 1, elite: false }],
};
const fourWaves: WaveData = {
  maxActiveEnemies: 1000,
  waves: [oneSlow, oneSlow, oneSlow, oneSlow, oneSlow],
};

/** Mapa pequeno com 5 ondas de 1 inimigo lento, recompensas nas ondas 2 e 3 e um matador ligável. */
function stackedSim() {
  const control = { kill: false };
  const killer: System = (ctx) => {
    if (!control.kill) return;
    for (const enemy of ctx.state.enemies.slots) {
      if (enemy.active) damageEnemy(ctx, slowEnemies, enemy, 1e9, null);
    }
  };
  const systems = createGameSystems(smallMap, {
    enemies: slowEnemies,
    nexus: blindNexus,
    waves: fourWaves,
    rewards: { ...rewardData, waves: [2, 3] },
    ticksPerSecond: TPS,
  });
  // Depois das ações e dos nascimentos, antes do fim das ondas.
  systems.splice(4, 0, killer);
  return { sim: new Simulation(makeState('pilha', blindNexus), systems), control };
}

describe('telas em fila', () => {
  it('ondas empilhadas fechando no mesmo tick: uma tela por vez, na ordem das ondas', () => {
    const { sim, control } = stackedSim();
    for (let i = 0; i < 4; i++) sim.enqueue({ type: 'callWave' });
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.state.waves.active.map((w) => w.wave)).toEqual([1, 2, 3, 4]);
    control.kill = true;
    const events = stepOnce(sim);
    control.kill = false;
    expect(ofType(events, 'waveEnded').map((e) => e.wave)).toEqual([1, 2, 3, 4]);
    expect(ofType(events, 'rewardOpened').map((e) => [e.wave, e.queued])).toEqual([[2, 1]]);
    expect(sim.state.rewards.queue).toEqual([3]);
    sim.enqueue({ type: 'chooseReward', index: 0 });
    const next = stepOnce(sim);
    expect(ofType(next, 'rewardChosen').map((e) => e.wave)).toEqual([2]);
    expect(ofType(next, 'rewardOpened').map((e) => e.wave)).toEqual([3]);
    // A segunda tela já não oferece o não repetível escolhido na primeira.
    const first = sim.state.rewards.taken[0]!;
    const taken = rewardData.byId.get(first.id)!;
    if (!taken.repeatable && taken.effect.kind !== 'classWildcard') {
      expect(ids(sim)).not.toContain(first.id);
    }
    // A segunda tela tem o tempo inteiro.
    expect(sim.state.rewards.screen!.ticksLeft).toBe(chooseTicks(rewardData, TPS));
    sim.enqueue({ type: 'chooseReward', index: 0 });
    stepOnce(sim);
    expect(sim.state.rewards.screen).toBeNull();
    expect(sim.state.rewards.taken.map((t) => t.wave)).toEqual([2, 3]);
  });

  it('o "Encerrar onda" do debug também enfileira as telas das ondas empilhadas', () => {
    const sim = shopSim('encerrar-pilha');
    sim.enqueue({ type: 'debugSkipToWave', wave: 4 });
    stepOnce(sim);
    for (let i = 0; i < 8; i++) sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(sim.state.waves.active.map((w) => w.wave)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    sim.enqueue({ type: 'endWave' });
    const events = stepOnce(sim);
    expect(ofType(events, 'rewardOpened').map((e) => e.wave)).toEqual([5]);
    expect(sim.state.rewards.queue).toEqual([10]);
  });
});

describe('save com tela pendente', () => {
  it('salvar no meio da tela (com reroll feito) e restaurar segue igual', () => {
    const play = (sim: Simulation, from: number, to: number) => {
      for (let i = from; i < to; i++) {
        if (i === 20) sim.enqueue({ type: 'rerollRewards' });
        if (i === 60) sim.enqueue({ type: 'chooseReward', index: 1 });
        sim.step();
      }
    };
    const reference = atWave5Screen('save');
    reference.enqueue({ type: 'debugOpenReward' });
    reference.state.gold = 100;
    const restoredFrom = atWave5Screen('save');
    restoredFrom.enqueue({ type: 'debugOpenReward' });
    restoredFrom.state.gold = 100;
    play(reference, 0, 200);
    play(restoredFrom, 0, 40);
    const json = restoredFrom.serialize();
    const saved = deserializeRunState(json);
    expect(saved.version).toBe(15);
    expect(saved.rewards.screen).toMatchObject({ wave: 5, rerolls: 1 });
    expect(saved.rewards.queue).toEqual([5]);
    const restored = Simulation.restore(json, createGameSystems(realMap));
    play(restored, 40, 200);
    expect(restored.serialize()).toBe(reference.serialize());
  });

  it('recusa save da versão 14 e recompensas inválidas', () => {
    const sim = atWave5Screen('save-invalido');
    expect(RUN_STATE_VERSION).toBe(15);
    const data = JSON.parse(sim.serialize()) as Record<string, unknown>;
    expect(() => deserializeRunState(JSON.stringify({ ...data, version: 14 }))).toThrow(/Versão/);
    const bad = structuredClone(data) as { rewards: { screen: { options: { id: string }[] } } };
    bad.rewards.screen.options[0]!.id = 'nada';
    expect(() => deserializeRunState(JSON.stringify(bad))).toThrow(/inválido/);
    const noRewardsState = structuredClone(data);
    delete noRewardsState.rewards;
    expect(() => deserializeRunState(JSON.stringify(noRewardsState))).toThrow(/inválido/);
  });
});

describe('tela (modelo)', () => {
  it('cartas com nome, frase, categoria e cor; coringa com a classe sorteada', () => {
    const sim = atWave5Screen('modelo');
    const state = sim.state as RunState;
    state.rewards.screen!.options = [
      { id: 'classWildcard', classId: 'shadow' },
      { id: 'income', classId: null },
      { id: 'artilleryArea', classId: null },
    ];
    state.rewards.queue.push(10);
    state.gold = 7;
    const model = buildRewardScreenModel(
      state,
      rewardData,
      classData,
      engineConfig.ticksPerSecond,
    )!;
    expect(model.title).toBe('Recompensa da onda 5');
    expect(model.queued).toBe('+1 na fila');
    expect(model.cards.map((c) => [c.key, c.name, c.category])).toEqual([
      ['1', 'Coringa: Sombria', 'Classe · Sombria'],
      ['2', 'Renda extra', 'Economia'],
      ['3', 'Artilharia pesada', 'Classe · Artilharia'],
    ]);
    expect(model.cards[0]!.text).toBe('Sombria conta +1 torre para o bônus de classe.');
    expect(model.cards[0]!.color).toBe(renderConfig.towers.classColors.shadow);
    expect(model.cards[1]!.color).toBe(uiConfig.rewardScreen.categoryColors.economy);
    expect(model.cards.map((c) => c.repeatable)).toEqual([false, true, true]);
    expect(model.rerollCost).toBe(5);
    expect(model.canReroll).toBe(true);
    expect(model.seconds).toBe(15);
    expect(model.timeLeft).toBe(1);
    state.gold = 4;
    expect(
      buildRewardScreenModel(state, rewardData, classData, engineConfig.ticksPerSecond)!.canReroll,
    ).toBe(false);
  });

  it('tela extra do debug e sem tela', () => {
    const sim = shopSim('modelo-extra');
    expect(buildRewardScreenModel(sim.state, rewardData, classData, 30)).toBeNull();
    sim.enqueue({ type: 'debugOpenReward' });
    sim.step();
    expect(buildRewardScreenModel(sim.state, rewardData, classData, 30)!.title).toBe(
      'Recompensa extra',
    );
  });
});

describe('política do bot bom', () => {
  it('pega a carta mais alta da ordem fixa; rerola só sem nenhuma das 6 primeiras e acima da reserva', () => {
    const decide = (options: string[], gold: number, rerolls = 0) => {
      const sim = atWave5Screen('bot-politica');
      const state = sim.state as RunState;
      state.rewards.screen!.options = options.map((id) => ({
        id,
        classId: id === 'classWildcard' ? 'arcane' : null,
      }));
      state.rewards.screen!.rerolls = rerolls;
      state.gold = gold;
      goodBotReward(sim);
      return state.commandQueue.at(-1);
    };
    expect(decide(['fullRefund', 'income', 'towerLimit'], 0)).toEqual({
      type: 'chooseReward',
      index: 2,
    });
    // Nenhuma das 6 primeiras: rerola se sobrar acima da reserva (onda 6: 40).
    expect(decide(['fullRefund', 'nexusDamage', 'chainGold'], 45)).toEqual({
      type: 'rerollRewards',
    });
    expect(decide(['fullRefund', 'nexusDamage', 'chainGold'], 44)).toEqual({
      type: 'chooseReward',
      index: 2,
    });
    expect(decide(['fullRefund', 'nexusDamage', 'chainGold'], 500, 2)).toEqual({
      type: 'chooseReward',
      index: 2,
    });
    expect(REWARD_PRIORITY).toHaveLength(rewardData.rewards.length);
  });

  it('a reserva de juros segue o teto (150 com o Cofre maior)', () => {
    const state = createRunState('reserva');
    expect(goodBotReserve(30, state)).toBe(100);
    state.rewards.taken.push({ id: 'interestCap', classId: null, wave: 5 });
    expect(goodBotReserve(30, state)).toBe(150);
    expect(goodBotReserve(8, state)).toBe(60);
  });
});
