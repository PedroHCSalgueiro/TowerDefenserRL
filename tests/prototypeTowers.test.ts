import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import mapData from '../src/data/map.json';
import { classData } from '../src/sim/classes/classData';
import { reducedTriggerCount } from '../src/sim/classes/bonuses';
import { loadEnemyData } from '../src/sim/enemies/enemyData';
import { Simulation } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import { createTargetScores } from '../src/sim/towers/targeting';
import type { RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { clampStar, towerDamage } from '../src/sim/towers/stars';
import {
  getTowerType,
  towerData,
  type TowerData,
  type TowerType,
} from '../src/sim/towers/towerData';
import { triggerAt } from '../src/sim/triggers/triggerData';
import { makeState, place, testEnemies } from './support/enemySim';
import { addTower, onRoute, run, smallRoutes } from './support/towerSim';
import {
  armedType,
  factsAt,
  firedSummary,
  killFact,
  ofType,
  triggerData,
  triggerSim,
} from './support/triggerSim';

const REAL = ['mortar', 'reaper', 'relay', 'obelisk', 'ballista', 'clock', 'executioner', 'mirror'];

const idle = <T extends { cooldownTicks: number }>(tower: T): T => {
  tower.cooldownTicks = 1e6;
  return tower;
};

function withTypes(extra: Record<string, TowerType>, rules: Partial<TowerData['triggers']> = {}) {
  const data = triggerData(rules);
  return { ...data, types: { ...data.types, ...extra } };
}

const shot = (towerId: number, kind: 'normal' | 'activated' | 'extra' = 'normal') =>
  ({ type: 'towerFired', tick: 0, towerId, targetId: 1, shot: kind }) as const;

// ---------------------------------------------------------------------------
// Dados das 8 torres
// ---------------------------------------------------------------------------

describe('dados das 8 torres do protótipo', () => {
  const real = REAL.map((id) => [id, getTowerType(towerData, id)] as const);

  it('são 8 torres reais mais as 2 de teste (Básica e Canhão), sem classe nem raridade', () => {
    expect(real.every(([, t]) => t.rarity !== null && t.classes.length === 2)).toBe(true);
    for (const id of ['basic', 'cannon']) {
      expect(towerData.types[id]).toMatchObject({ rarity: null, classes: [], trigger: null });
    }
    expect(Object.keys(towerData.types).sort()).toEqual([...REAL, 'basic', 'cannon'].sort());
  });

  it('cada classe aparece em exatamente 4 torres reais', () => {
    for (const id of classData.ids) {
      const members = real.filter(([, t]) => t.classes.includes(id)).map(([tower]) => tower);
      expect(members, id).toHaveLength(4);
    }
    expect(
      Object.fromEntries(
        classData.ids.map((id) => [
          id,
          real.filter(([, t]) => t.classes.includes(id)).map(([n]) => n),
        ]),
      ),
    ).toEqual({
      artillery: ['mortar', 'reaper', 'ballista', 'executioner'],
      mechanical: ['mortar', 'relay', 'clock', 'mirror'],
      arcane: ['relay', 'obelisk', 'ballista', 'mirror'],
      shadow: ['reaper', 'obelisk', 'clock', 'executioner'],
    });
  });

  it('raridades: 3 comuns, 3 incomuns e 2 raras', () => {
    const count = (r: string) => real.filter(([, t]) => t.rarity === r).length;
    expect([count('common'), count('uncommon'), count('rare')]).toEqual([3, 3, 2]);
    expect(real.filter(([, t]) => t.rarity === 'rare').map(([id]) => id)).toEqual([
      'executioner',
      'mirror',
    ]);
  });

  it('todas têm ★1, ★2 e ★3', () => {
    for (const [id, t] of real) expect(t.trigger?.stars, id).toHaveLength(3);
  });

  it('ataque normal (dano · tiros/s · alcance) da proposta', () => {
    const attack = (id: string) => {
      const t = getTowerType(towerData, id);
      return [t.damage, t.attacks ? t.shotsPerSecond : null, t.range];
    };
    expect(REAL.map(attack)).toEqual([
      [8, 0.8, 3],
      [6, 1, 2.5],
      [5, 1.5, 3],
      [10, 0.5, 3.5],
      [6, 0.6, 4],
      [6, 1, 3],
      [8, 0.7, 3],
      [8, null, 3], // Espelho: não ataca
    ]);
    expect(getTowerType(towerData, 'mortar').shot).toEqual({ kind: 'area', radius: 1 });
    expect(getTowerType(towerData, 'mirror').attacks).toBe(false);
  });

  const star = (id: string, n: number) => triggerAt(getTowerType(towerData, id).trigger!, n);

  it('Morteiro, Ceifador, Relé e Obelisco: ★1, ★2 e ★3', () => {
    expect([1, 2, 3].map((n) => star('mortar', n))).toMatchObject([
      {
        when: { kind: 'everyNShots', shots: 5 },
        effect: { extraShots: 2, spread: false },
        attackDamagePercent: 100,
      },
      { when: { shots: 4 }, effect: { extraShots: 2, spread: false }, attackDamagePercent: 125 },
      { when: { shots: 4 }, effect: { extraShots: 3, spread: true }, attackDamagePercent: 125 },
    ]);
    expect([1, 2, 3].map((n) => star('reaper', n))).toMatchObject([
      {
        when: { kind: 'enemyDiesInRange' },
        effect: { radius: 1, damagePercent: 100, killWeight: 1 },
      },
      { effect: { radius: 1.3, damagePercent: 130, killWeight: 1 } },
      { effect: { radius: 1.3, damagePercent: 130, killWeight: 2 } },
    ]);
    expect([1, 2, 3].map((n) => star('relay', n))).toMatchObject([
      {
        when: { kind: 'onFire' },
        effect: { maxTargets: 0, activatedDamagePercent: 100, reach: 0 },
      },
      { effect: { maxTargets: 0, activatedDamagePercent: 150, reach: 0 } },
      { effect: { maxTargets: 0, activatedDamagePercent: 200, reach: 2 } },
    ]);
    expect([1, 2, 3].map((n) => star('obelisk', n))).toMatchObject([
      {
        when: { kind: 'neighborKills' },
        effect: {
          charges: 3,
          targets: 4,
          jumpRadius: 2,
          damagePercent: 100,
          activateOnDischarge: false,
        },
      },
      {
        effect: {
          charges: 3,
          targets: 6,
          jumpRadius: 2,
          damagePercent: 130,
          activateOnDischarge: false,
        },
      },
      {
        effect: {
          charges: 2,
          targets: 6,
          jumpRadius: 2,
          damagePercent: 130,
          activateOnDischarge: true,
        },
      },
    ]);
  });

  it('Balista, Relógio, Carrasco e Espelho: ★1, ★2 e ★3', () => {
    expect([1, 2, 3].map((n) => star('ballista', n))).toMatchObject([
      {
        when: { kind: 'onActivated' },
        effect: { halfWidth: 0.5, damagePercent: 400, unlimited: false },
      },
      { effect: { halfWidth: 0.6, damagePercent: 600, unlimited: false } },
      { effect: { halfWidth: 0.6, damagePercent: 800, unlimited: true } },
    ]);
    expect([1, 2, 3].map((n) => star('clock', n))).toMatchObject([
      {
        when: { kind: 'everyNKillsInRange', kills: 10 },
        effect: { maxTargets: 0, activatedDamagePercent: 100, selfToo: false },
      },
      { when: { kills: 8 }, effect: { activatedDamagePercent: 150, selfToo: false } },
      { when: { kills: 5 }, effect: { activatedDamagePercent: 200, selfToo: true } },
    ]);
    expect([1, 2, 3].map((n) => star('executioner', n))).toMatchObject([
      {
        when: { kind: 'onFire' },
        effect: { hpPercent: 15, killWeight: 2, bossMaxHpPercent: 3, explodeRadius: 0 },
      },
      { effect: { hpPercent: 25, killWeight: 2, bossMaxHpPercent: 5, explodeRadius: 0 } },
      {
        effect: {
          hpPercent: 30,
          killWeight: 2,
          bossMaxHpPercent: 8,
          explodeRadius: 1,
          explodeDamagePercent: 100,
        },
      },
    ]);
    expect([1, 2, 3].map((n) => star('mirror', n))).toMatchObject([
      { when: { kind: 'onActivated' }, effect: { powerPercent: 100, copies: 1 } },
      { effect: { powerPercent: 150, copies: 1 } },
      { effect: { powerPercent: 150, copies: 2 } },
    ]);
  });

  it('a ★3 herda os números da ★2 (só cresce ou acrescenta)', () => {
    for (const [id] of real) {
      const two = star(id, 2);
      const three = star(id, 3);
      const flat = (s: typeof two) => ({
        ...s.when,
        ...s.effect,
        attackDamagePercent: s.attackDamagePercent,
      });
      const a = flat(two) as Record<string, number | boolean | string>;
      const b = flat(three) as Record<string, number | boolean | string>;
      // Contagens que baixam (menos abates/tiros/cargas) e os números que sobem são a ★3 melhorando.
      const better = new Set(['shots', 'kills', 'charges']);
      for (const key of Object.keys(a)) {
        const x = a[key]!;
        const y = b[key]!;
        if (typeof x === 'number' && typeof y === 'number') {
          expect(better.has(key) ? y <= x : y >= x, `${id}.${key}`).toBe(true);
        } else if (typeof x === 'boolean') {
          expect(!x || y === true, `${id}.${key}`).toBe(true);
        }
      }
    }
  });

  it('o cenário de 8 tipos do debug usa as 8 torres reais', () => {
    expect(debugConfig.fullScenario.towerTypes).toEqual(REAL);
  });

  it('Mecânica sobre a contagem de cada estrela: Relógio ★3 (5 abates) −40% → 3', () => {
    const state = makeState();
    state.classes.mechanical!.level = 2;
    const clock = getTowerType(towerData, 'clock');
    expect(reducedTriggerCount(classData, state, clock, 5)).toBe(3);
    expect(reducedTriggerCount(classData, state, clock, 8)).toBe(4);
    expect(reducedTriggerCount(classData, state, clock, 10)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Estrela da torre
// ---------------------------------------------------------------------------

describe('estrela da torre (spawn do debug)', () => {
  it('clampStar prende entre ★1 e a última estrela do tipo; torre sem gatilho é só ★1', () => {
    const mortar = getTowerType(towerData, 'mortar');
    expect([0, 1, 2, 3, 4, NaN, 2.9].map((s) => clampStar(mortar, s))).toEqual([
      1, 1, 2, 3, 3, 1, 2,
    ]);
    expect(clampStar(getTowerType(towerData, 'basic'), 3)).toBe(1);
  });

  it('o dano do ataque normal leva o bônus da estrela (Morteiro ★2: +25%)', () => {
    const mortar = getTowerType(towerData, 'mortar');
    const at = (star: number) => towerDamage(mortar, { star } as never);
    expect([at(1), at(2), at(3)]).toEqual([8, 10, 10]);
  });

  it('debugSpawnTowers com star: as torres nascem na estrela pedida (presa ao máximo)', () => {
    const map = loadMap(mapData);
    const sim = Simulation.create('star', createGameSystems(map));
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: 4,
      towerTypes: ['mortar', 'basic'],
      layout: 'clustered',
      star: 3,
    });
    sim.enqueue({ type: 'placeTower', towerType: 'reaper', x: 12, y: 12, star: 2 });
    sim.enqueue({ type: 'placeTower', towerType: 'reaper', x: 11, y: 12 });
    run(sim, 1);
    const stars = sim.state.towers.map((t) => `${t.type}:${t.star}`);
    expect(stars.filter((s) => s.startsWith('mortar')).every((s) => s === 'mortar:3')).toBe(true);
    expect(stars.filter((s) => s.startsWith('basic')).every((s) => s === 'basic:1')).toBe(true);
    expect(stars.slice(-2)).toEqual(['reaper:2', 'reaper:1']);
  });

  it('o motor usa o gatilho da estrela de cada torre', () => {
    const firstFire = (star: number): number => {
      const state = makeState();
      const t = idle(addTower(state, 'mortar', 0, 0));
      t.star = star;
      const shots = Array.from({ length: 6 }, (_, i) => factsAt(i + 1, [shot(t.id)]));
      const events = run(triggerSim(state, towerData, shots), 6);
      return ofType(events, 'triggerFired')[0]!.tick;
    };
    expect([1, 2, 3].map(firstFire)).toEqual([5, 4, 4]); // ★1 a cada 5 tiros; ★2 e ★3 a cada 4
  });

  it('Morteiro ★2: o tiro em área causa 10 em vez de 8', () => {
    const loss = (star: number): number => {
      const state = makeState();
      addTower(state, 'mortar', 0, 0).star = star;
      const brick = place(state, 'brick', 1, 0, 1e9);
      run(triggerSim(state, towerData), 4);
      return 1e9 - brick.hp;
    };
    expect([1, 2, 3].map(loss)).toEqual([8, 10, 10]);
  });
});

// ---------------------------------------------------------------------------
// Efeitos novos do motor
// ---------------------------------------------------------------------------

describe('activatedDamagePercent: dano do tiro ativado', () => {
  it('a vizinha ativada atira com o % do dano dela', () => {
    const relay = armedType('onFire', 'activateNeighbors', { activatedDamagePercent: 150 });
    const loss = (type: string): number => {
      const state = makeState();
      const r = idle(addTower(state, type, 1, 0));
      idle(addTower(state, 'arrow', 0, 0)); // dano 6
      const brick = place(state, 'brick', 0.5, 0.5, 1e9);
      run(triggerSim(state, withTypes({ relay150: relay }), [factsAt(1, [shot(r.id)])]), 5);
      return 1e9 - brick.hp;
    };
    expect(loss('relay150')).toBe(9); // 150% de 6
    expect(loss('relay')).toBe(6); // 100%
  });
});

describe('reach: cruz de alcance somada à vizinhança', () => {
  const reachRelay = armedType('onFire', 'activateNeighbors', { reach: 2 });
  const activations = (arcane: number, type: string): number => {
    const state = makeState();
    state.classes.arcane!.level = arcane;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx !== 0 || dy !== 0) idle(addTower(state, 'arrow', 5 + dx, 5 + dy));
      }
    }
    const relay = idle(addTower(state, type, 5, 5));
    const sim = triggerSim(state, withTypes({ reachRelay }), [factsAt(1, [shot(relay.id)])]);
    return ofType(run(sim, 1), 'towerActivated').length;
  };

  it('sem Arcana: 4 vizinhas + 4 casas a 2 em linha reta = 8', () => {
    expect(activations(0, 'reachRelay')).toBe(8);
    expect(activations(0, 'relay')).toBe(4);
  });

  it('Arcana nível 2 (8 vizinhas) + a cruz: 12 casas; nível 4 (5×5): 24', () => {
    expect(activations(1, 'reachRelay')).toBe(12);
    expect(activations(2, 'reachRelay')).toBe(24);
  });

  it('a cruz não passa de reach: a 3 casas ninguém é ativado', () => {
    const state = makeState();
    const relay = idle(addTower(state, 'reachRelay', 5, 5));
    idle(addTower(state, 'arrow', 8, 5));
    idle(addTower(state, 'arrow', 5, 7));
    const sim = triggerSim(state, withTypes({ reachRelay }), [factsAt(1, [shot(relay.id)])]);
    expect(ofType(run(sim, 1), 'towerActivated').map((e) => e.towerId)).toEqual([
      state.towers[2]!.id,
    ]);
  });
});

describe('selfToo: a torre também ativa a si mesma', () => {
  const selfClock = armedType('everyNKillsInRange', 'activateNeighbors', {
    kills: 1,
    selfToo: true,
    activatedDamagePercent: 200,
  });

  it('dispara um tiro ativado no próprio alvo e respeita a trava de 1 s da própria torre', () => {
    const state = makeState();
    const clock = idle(addTower(state, 'selfClock', 0, 0)); // dano 6
    const brick = place(state, 'brick', 0.5, 0, 1e9);
    const kill = killFact(0.5, 0, 9);
    const sim = triggerSim(state, withTypes({ selfClock }), [
      factsAt(1, [kill]),
      factsAt(2, [kill]), // na trava
      factsAt(9, [kill]), // trava de 8 ticks acabou
    ]);
    const events = run(sim, 12);
    const self = ofType(events, 'towerActivated').filter((e) => e.towerId === clock.id);
    expect(self.map((e) => [e.tick, e.sourceTowerId])).toEqual([
      [1, clock.id],
      [9, clock.id],
    ]);
    expect(ofType(events, 'towerFired').filter((e) => e.shot === 'activated')).toHaveLength(2);
    expect(1e9 - brick.hp).toBe(24); // 2 tiros de 200% de 6
  });

  it('a trava vale também contra ativação de uma vizinha', () => {
    const state = makeState();
    const clock = idle(addTower(state, 'selfClock', 0, 0));
    clock.activationReadyTick = 5;
    place(state, 'brick', 0.5, 0, 1e9);
    const sim = triggerSim(state, withTypes({ selfClock }), [factsAt(1, [killFact(0.5, 0, 9)])]);
    expect(ofType(run(sim, 3), 'towerActivated')).toEqual([]);
  });
});

describe('killWeight na explosão', () => {
  it('as mortes causadas pela explosão valem o peso pedido', () => {
    const blast = (weight: number) =>
      armedType('enemyDiesInRange', 'explosion', {
        radius: 0.5,
        damagePercent: 100,
        killWeight: weight,
      });
    const weightOf = (type: string): number => {
      const state = makeState();
      idle(addTower(state, type, 0, 0));
      const weak = place(state, 'walker', 1, 0.2, 1);
      const events = run(
        triggerSim(state, withTypes({ w1: blast(1), w2: blast(2) }), [
          factsAt(1, [killFact(1, 0, 9)]),
        ]),
        1,
      );
      return ofType(events, 'enemyKilled').find((e) => e.enemyId === weak.id)!.weight;
    };
    expect([weightOf('w1'), weightOf('w2')]).toEqual([1, 2]);
  });
});

describe('spread: cada tiro extra num alvo diferente, na ordem de mira', () => {
  const spread = armedType('onFire', 'multiShot', { extraShots: 3, spread: true });
  const plain = armedType('onFire', 'multiShot', { extraShots: 3 });

  function extraTargets(type: string, distances: number[]): number[] {
    const state = makeState();
    const t = idle(addTower(state, type, 1, 0));
    const ids = distances.map((d) => onRoute(state, 'brick', d, 1e9).id);
    const events = run(
      triggerSim(state, withTypes({ spread, plain }), [factsAt(1, [shot(t.id)])]),
      1,
    );
    const indexOf = (id: number) => ids.indexOf(id);
    return ofType(events, 'towerFired')
      .filter((e) => e.shot === 'extra')
      .map((e) => indexOf(e.targetId));
  }

  // Na rota do mapa pequeno, distância maior = mais perto do núcleo = "primeiro".
  it('3 alvos: o melhor, o segundo e o terceiro', () => {
    expect(extraTargets('spread', [1, 2, 1.5])).toEqual([1, 2, 0]); // 2 > 1,5 > 1
  });

  it('menos alvos que tiros: dá a volta na ordem de mira', () => {
    expect(extraTargets('spread', [1, 2])).toEqual([1, 0, 1]);
  });

  it('um alvo só: todos os tiros vão nele', () => {
    expect(extraTargets('spread', [1.5])).toEqual([0, 0, 0]);
  });

  it('sem spread, todos no alvo normal (o melhor)', () => {
    expect(extraTargets('plain', [1, 2, 1.5])).toEqual([1, 1, 1]);
  });

  it('sem alvo, nada acontece', () => {
    expect(extraTargets('spread', [])).toEqual([]);
  });
});

describe('findBestN', () => {
  it('devolve os N melhores, na mesma ordem de sort por nota e id, e menos se faltar', () => {
    const state = makeState();
    const enemies = [3, 1, 2, 2, 5, 4, 0.5].map((d) => onRoute(state, 'walker', d));
    const index = new SpatialIndex(1);
    const score = createTargetScores(smallRoutes, testEnemies).first;
    const all = [...enemies].sort((a, b) => score(a, 0, 0) - score(b, 0, 0) || a.id - b.id);
    for (const n of [0, 1, 3, 7, 10]) {
      const out: typeof enemies = [];
      index.findBestN(state, 1.5, 1, 20, score, n, out);
      expect(out.map((e) => e.id)).toEqual(all.slice(0, n).map((e) => e.id));
    }
    expect(index.findBestN(state, 1.5, 1, 20, score, 1, [])[0]).toBe(
      index.findBest(state, 1.5, 1, 20, score),
    );
  });
});

describe('activateOnDischarge: o raio ativa as vizinhas', () => {
  const storm = (activateOnDischarge: boolean) =>
    armedType('neighborKills', 'chargeLightning', {
      charges: 1,
      targets: 1,
      jumpRadius: 1,
      damagePercent: 100,
      activateOnDischarge,
    });

  const activated = (type: string): number[] => {
    const state = makeState();
    idle(addTower(state, type, 2, 0));
    const killer = idle(addTower(state, 'arrow', 1, 0));
    idle(addTower(state, 'arrow', 2, 1));
    place(state, 'brick', 2, 0.5, 1e9);
    const types = { withFlag: storm(true), without: storm(false) };
    const events = run(
      triggerSim(state, withTypes(types), [factsAt(1, [killFact(0, 0, killer.id)])]),
      1,
    );
    return ofType(events, 'towerActivated').map((e) => e.towerId);
  };

  it('com a opção, solta o raio e ativa todas as vizinhas; sem ela, não ativa ninguém', () => {
    expect(activated('withFlag')).toHaveLength(2);
    expect(activated('without')).toEqual([]);
  });
});

describe('pierceLine sem limite', () => {
  const loss = (unlimited: boolean) => {
    const state = makeState();
    const t = idle(addTower(state, 'piercer', 0, 0)); // alcance 2
    const near = place(state, 'brick', 1, 0, 1e9);
    const far = place(state, 'brick', 5, 0, 1e9);
    const offLine = place(state, 'brick', 5, 1, 1e9);
    const piercer = armedType(
      'onFire',
      'pierceLine',
      { halfWidth: 0.25, damagePercent: 100 },
      { range: 2 },
    );
    const unlimitedType = armedType(
      'onFire',
      'pierceLine',
      { halfWidth: 0.25, damagePercent: 100, unlimited: true },
      { range: 2 },
    );
    const type = unlimited ? unlimitedType : piercer;
    const data = withTypes({ piercer: type });
    run(triggerSim(state, data, [factsAt(1, [shot(t.id)])]), 1);
    return [1e9 - near.hp, 1e9 - far.hp, 1e9 - offLine.hp];
  };

  it('com "unlimited" a linha atravessa o mapa; sem ele, para no alcance', () => {
    expect(loss(false)).toEqual([6, 0, 0]);
    expect(loss(true)).toEqual([6, 6, 0]);
  });
});

describe('execução: chefão, golpe crítico e explosão', () => {
  const exec = (params: Record<string, number>) => armedType('onFire', 'execute', params);
  const base = { hpPercent: 25, killWeight: 2, bossMaxHpPercent: 5 };

  function setup(params: Record<string, number>, rules: Partial<TowerData['triggers']> = {}) {
    const state = makeState();
    const tower = idle(addTower(state, 'exec', 0, 0));
    const data = withTypes({ exec: exec(params) }, rules);
    return {
      state,
      tower,
      data,
      sim: (before: number) => triggerSim(state, data, [factsAt(before, [shot(tower.id)])]),
    };
  }

  it('o chefão nunca é executado: abaixo do limite leva 5% da vida máxima, com armadura', () => {
    const { state, sim } = setup(base);
    const boss = place(state, 'titan', 1, 0, 100);
    boss.hp = 20; // 20% < 25%
    const above = place(state, 'titan', 0, 1, 100);
    above.hp = 60;
    const weak = place(state, 'walker', 1, 1, 10);
    weak.hp = 2;
    const events = run(sim(1), 1);
    // Crítico: 5% de 100 = 5, com armadura 50 (×100/150) → 3,33.
    expect(boss.hp).toBeCloseTo(20 - 5 * (100 / 150), 9);
    expect(above.hp).toBe(60);
    const kills = ofType(events, 'enemyKilled');
    expect(kills.map((e) => [e.enemyId, e.weight])).toEqual([[weak.id, 2]]);
  });

  it('crítico que mata o chefão é abate de peso 1 (o peso 2 é só da execução)', () => {
    const { state, sim } = setup(base);
    const boss = place(state, 'titan', 1, 0, 100);
    boss.hp = 3;
    const events = run(sim(1), 1);
    expect(ofType(events, 'enemyKilled').map((e) => [e.enemyId, e.weight])).toEqual([[boss.id, 1]]);
  });

  it('sem bossMaxHpPercent, o chefão só é poupado', () => {
    const { state, sim } = setup({ hpPercent: 25, killWeight: 2 });
    const boss = place(state, 'titan', 1, 0, 100);
    boss.hp = 20;
    run(sim(1), 1);
    expect(boss.hp).toBe(20);
  });

  it('★3: cada execução põe uma explosão na fila (raio 1, 100% do dano), com profundidade + 1', () => {
    const { state, tower, sim } = setup({ ...base, explodeRadius: 1, explodeDamagePercent: 100 });
    const a = place(state, 'walker', 1, 0, 10);
    a.hp = 1;
    const b = place(state, 'walker', 0, 1, 10);
    b.hp = 1;
    const bystander = place(state, 'brick', 0.5, 0.5, 1e9); // a 0,7 dos dois
    const far = place(state, 'brick', 1.4, 1.4, 1e9); // fora dos dois raios
    const events = run(sim(1), 1);
    expect(firedSummary(events, { [tower.id]: 'carrasco' })).toEqual([
      'carrasco:execute@1',
      'carrasco:explosion@2',
      'carrasco:explosion@2',
    ]);
    expect(ofType(events, 'areaExploded').map((e) => [e.x, e.y, e.radius])).toEqual([
      [1, 0, 1],
      [0, 1, 1],
    ]);
    expect(1e9 - bystander.hp).toBe(12); // 2 explosões × 6 de dano (Flecha)
    expect(far.hp).toBe(1e9);
    expect(tower.lastEffect?.effect.kind).toBe('execute'); // a explosão não vira "último efeito"
  });

  it('as explosões entram no orçamento do tick: com 1 entrada por tick, saem uma por tick', () => {
    const { state, sim } = setup(
      { ...base, explodeRadius: 1, explodeDamagePercent: 100 },
      { maxActivationsPerTick: 1 },
    );
    for (const [x, y] of [
      [1, 0],
      [0, 1],
    ] as const)
      place(state, 'walker', x, y, 10).hp = 1;
    const events = run(sim(1), 4);
    expect(ofType(events, 'areaExploded').map((e) => e.tick)).toEqual([2, 3]);
    expect(state.triggers.queue).toEqual([]);
  });

  it('as mortes da explosão alimentam as outras torres (Ceifador reage)', () => {
    const { state, sim } = setup({ ...base, explodeRadius: 1, explodeDamagePercent: 100 });
    const executed = place(state, 'walker', 1, 0, 10);
    executed.hp = 1;
    const victim = place(state, 'walker', 1.5, 0.5, 4); // morre com 6 de explosão
    const reaper = addTower(state, 'reaper', 0, 2);
    idle(reaper);
    // O Ceifador (alcance 1,5) alcança (1, 0)? A distância a (0,2) é 2,2: não; a (1,1)? mova.
    reaper.x = 1;
    reaper.y = 1;
    const events = run(sim(1), 1);
    const reactions = ofType(events, 'triggerFired').filter((e) => e.towerId === reaper.id);
    expect(reactions.length).toBeGreaterThanOrEqual(1);
    expect(ofType(events, 'enemyKilled').some((e) => e.enemyId === victim.id)).toBe(true);
  });
});

describe('Espelho: powerPercent, copies e sem ataque', () => {
  const mimic = (params: Record<string, number>) =>
    armedType('onActivated', 'copyLast', params, { damage: 10 });
  const activated = (id: number) =>
    ({ type: 'towerActivated', tick: 0, towerId: id, sourceTowerId: id, depth: 1 }) as const;

  function setup(params: Record<string, number>) {
    const state = makeState();
    const m = idle(addTower(state, 'mimic', 5, 5));
    const a = idle(addTower(state, 'arrow', 5, 4));
    const b = idle(addTower(state, 'arrow', 4, 5));
    const c = idle(addTower(state, 'arrow', 6, 5));
    idle(addTower(state, 'arrow', 5, 6)); // nunca disparou
    a.lastEffect = {
      effect: { kind: 'explosion', radius: 0.5, damagePercent: 50, killWeight: 1 },
      seq: 1,
    };
    b.lastEffect = {
      effect: { kind: 'pierceLine', halfWidth: 0.25, damagePercent: 100, unlimited: false },
      seq: 2,
    };
    c.lastEffect = {
      effect: { kind: 'explosion', radius: 0.5, damagePercent: 100, killWeight: 1 },
      seq: 3,
    };
    const brick = place(state, 'brick', 5.5, 5.2, 1e9);
    const sim = triggerSim(state, withTypes({ mimic: mimic(params) }), [
      factsAt(1, [activated(m.id)]),
    ]);
    return { state, m, brick, sim };
  }

  it('powerPercent 150 escala só o dano do efeito copiado', () => {
    const { brick, sim, m } = setup({ powerPercent: 150 });
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').map((e) => e.effect)).toEqual(['explosion']);
    expect(1e9 - brick.hp).toBe(15); // 100% × 150% de 10
    expect(m.lastEffect?.effect).toMatchObject({ kind: 'explosion', damagePercent: 150 });
  });

  it('copies 2: os dois efeitos mais recentes, de vizinhas diferentes, o mais novo primeiro', () => {
    const { brick, sim } = setup({ powerPercent: 150, copies: 2 });
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').map((e) => e.effect)).toEqual([
      'explosion',
      'pierceLine',
    ]);
    expect(1e9 - brick.hp).toBe(30);
  });

  it('com uma vizinha só que disparou, copies 2 copia um efeito só', () => {
    const state = makeState();
    const m = idle(addTower(state, 'mimic', 5, 5));
    const a = idle(addTower(state, 'arrow', 5, 4));
    a.lastEffect = {
      effect: { kind: 'explosion', radius: 0.5, damagePercent: 100, killWeight: 1 },
      seq: 1,
    };
    place(state, 'brick', 5.5, 5.2, 1e9);
    const sim = triggerSim(state, withTypes({ mimic: mimic({ copies: 2 }) }), [
      factsAt(1, [activated(m.id)]),
    ]);
    expect(ofType(run(sim, 1), 'triggerFired')).toHaveLength(1);
  });

  it('sem nada para copiar, o gatilho dispara e não faz nada', () => {
    const state = makeState();
    const m = idle(addTower(state, 'mimic', 5, 5));
    const sim = triggerSim(state, withTypes({ mimic: mimic({ copies: 2 }) }), [
      factsAt(1, [activated(m.id)]),
    ]);
    expect(ofType(run(sim, 1), 'triggerFired').map((e) => e.effect)).toEqual(['copyLast']);
  });

  it('o Espelho real não ataca, nem quando ativado (só executa o que copia)', () => {
    const state = makeState();
    const mirror = addTower(state, 'mirror', 5, 5);
    place(state, 'brick', 5.5, 5.2, 1e9);
    const events = run(triggerSim(state, towerData), 60);
    expect(ofType(events, 'towerFired').filter((e) => e.towerId === mirror.id)).toEqual([]);

    // Ativado por um Relé, ele conta a ativação e não atira.
    const relayState = makeState();
    const relay = idle(addTower(relayState, 'relay', 5, 6));
    const m = addTower(relayState, 'mirror', 5, 5);
    place(relayState, 'brick', 5.5, 5.2, 1e9);
    const activatedEvents = run(
      triggerSim(relayState, towerData, [factsAt(1, [shot(relay.id)])]),
      3,
    );
    expect(ofType(activatedEvents, 'towerActivated').some((e) => e.towerId === m.id)).toBe(true);
    expect(ofType(activatedEvents, 'towerFired').some((e) => e.towerId === m.id)).toBe(false);
  });
});

describe('marcador boss nos dados de inimigo', () => {
  const raw = (boss: unknown) => ({
    armor: { scale: 100 },
    types: {
      big: { hp: 100, speed: 1, armor: 0, nexusDamage: 1, gold: 1, movement: 'ground', boss },
    },
  });

  it('padrão false; aceita true; rejeita o que não é booleano', () => {
    const plain = { ...raw(undefined) };
    delete (plain.types.big as Record<string, unknown>).boss;
    expect(loadEnemyData(plain).types.big!.boss).toBe(false);
    expect(loadEnemyData(raw(true)).types.big!.boss).toBe(true);
    expect(() => loadEnemyData(raw('sim'))).toThrow(/inválido/);
  });

  it('o enemies.json real não tem chefão (ele é da T13)', () => {
    const plain = loadEnemyData(JSON.parse(JSON.stringify(raw(false))));
    expect(Object.values(plain.types).some((t) => t.boss)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cada torre isolada e em dupla, em ★1, ★2 e ★3, no jogo de verdade
// ---------------------------------------------------------------------------

describe('cada torre isolada e em dupla (mapa e dados reais)', () => {
  const map = loadMap(mapData);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height && cells.length < 2; y++) {
    for (let x = 0; x + 1 < map.width && cells.length < 2; x++) {
      if (map.canPlaceTower({ x, y }) && map.canPlaceTower({ x: x + 1, y })) {
        cells.push({ x, y }, { x: x + 1, y });
      }
    }
  }

  function game(types: string[], star: number, layout: 'spread' | 'clustered'): Simulation {
    const sim = Simulation.create('solo', createGameSystems(map));
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    types.forEach((towerType, i) =>
      sim.enqueue({ type: 'placeTower', towerType, x: cells[i]!.x, y: cells[i]!.y, star }),
    );
    sim.enqueue({ type: 'debugSetStress', stress: { count: 150, layout } });
    return sim;
  }

  const healthy = (state: RunState): boolean =>
    state.enemies.slots.every((e) => !e.active || Number.isFinite(e.hp)) &&
    state.triggers.queue.length <= 10000;

  it('cada uma das 8, sozinha, em ★1, ★2 e ★3: roda e é determinística', () => {
    for (const type of REAL) {
      for (const star of [1, 2, 3]) {
        const a = game([type], star, 'clustered');
        const b = game([type], star, 'clustered');
        run(a, 120);
        run(b, 120);
        expect(a.state.towers[0]!.star, `${type} ★${star}`).toBe(star);
        expect(healthy(a.state), `${type} ★${star}`).toBe(true);
        expect(b.serialize(), `${type} ★${star}`).toBe(a.serialize());
      }
    }
  });

  it('todas as duplas de torres diferentes em ★1, ★2 e ★3 rodam sem erro', () => {
    for (let i = 0; i < REAL.length; i++) {
      for (let j = i + 1; j < REAL.length; j++) {
        for (const star of [1, 2, 3]) {
          const sim = game([REAL[i]!, REAL[j]!], star, 'spread');
          run(sim, 100);
          expect(healthy(sim.state), `${REAL[i]}+${REAL[j]} ★${star}`).toBe(true);
        }
      }
    }
  });

  it('as 8 juntas em ★3: salvar no meio e retomar dá o mesmo resultado', () => {
    const build = (): Simulation => {
      const sim = Simulation.create('oito', createGameSystems(map));
      sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
      sim.enqueue({
        type: 'debugSpawnTowers',
        count: 30,
        towerTypes: REAL,
        layout: 'clustered',
        star: 3,
      });
      sim.enqueue({ type: 'debugSetStress', stress: { count: 300, layout: 'clustered' } });
      return sim;
    };
    const a = build();
    run(a, 100);
    expect(Object.values(a.state.classes).map((c) => c.level)).toEqual([2, 2, 2, 2]);
    const resumed = new Simulation(JSON.parse(a.serialize()) as RunState, createGameSystems(map));
    run(a, 150);
    run(resumed, 150);
    expect(resumed.serialize()).toBe(a.serialize());
    const again = build();
    run(again, 250);
    expect(again.serialize()).toBe(a.serialize());
  });
});
