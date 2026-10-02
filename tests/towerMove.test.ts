import { describe, expect, it } from 'vitest';
import { damageEnemy } from '../src/sim/enemies/damage';
import type { EnemyData } from '../src/sim/enemies/enemyData';
import type { Enemy } from '../src/sim/enemies/pool';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation, type System } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { serializeRunState, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { moveTower, towersLocked } from '../src/sim/towers/move';
import type { Tower } from '../src/sim/towers/placement';
import type { WaveData } from '../src/sim/waves/waveData';
import { TPS, blindNexus, makeState, place, smallMap, testEnemies } from './support/enemySim';
import { freeCells, realMap, shopSim, stepOnce } from './support/shopSim';
import { addTower } from './support/towerSim';
import { ofType, triggerSim } from './support/triggerSim';

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

/** Inimigo lento e quase imortal: só o "matador" do teste derruba (as torres reais não). */
const moveEnemies: EnemyData = {
  armor: testEnemies.armor,
  elite: testEnemies.elite,
  types: {
    ...testEnemies.types,
    slow: {
      hp: 1e9,
      speed: 0.25,
      armor: 0,
      nexusDamage: 1,
      gold: 1,
      movement: 'ground',
      boss: false,
    },
  },
};

const slow = (count: number) => ({
  hpMultiplier: 1,
  spawnSeconds: 0.25,
  enemies: [{ type: 'slow', count, elite: false }],
});

const moveWaves: WaveData = {
  maxActiveEnemies: 1000,
  waves: [slow(2), slow(1), slow(1), slow(1)],
};

/**
 * Partida no mapa pequeno com as torres reais e um "matador" de teste logo
 * depois dos nascimentos: a cada tick, mata os inimigos que `kill` escolher.
 */
function moveSim(seed = 'mover') {
  const control: { kill: (enemy: Enemy) => boolean } = { kill: () => false };
  const killer: System = (ctx) => {
    for (const enemy of ctx.state.enemies.slots) {
      if (enemy.active && control.kill(enemy)) {
        damageEnemy(ctx, moveEnemies, enemy, 1e12, null, { ignoreArmor: true });
      }
    }
  };
  const systems = createGameSystems(smallMap, {
    enemies: moveEnemies,
    nexus: blindNexus,
    waves: moveWaves,
    ticksPerSecond: TPS,
  });
  systems.splice(2, 0, killer);
  const sim = new Simulation(makeState(seed, blindNexus), systems);
  return { sim, control };
}

/** Casas livres do mapa pequeno (o caminho é a linha y=1 até x=3, a coluna x=3 e a linha y=3). */
const A = { x: 0, y: 0 };
const B = { x: 1, y: 0 };
const C = { x: 4, y: 2 };
const PATH = { x: 2, y: 1 };

function put(sim: Simulation, towerType: string, cell: { x: number; y: number }): Tower {
  sim.enqueue({ type: 'placeTower', towerType, ...cell });
  stepOnce(sim);
  return sim.state.towers.find((t) => t.x === cell.x && t.y === cell.y)!;
}

function move(sim: Simulation, tower: Tower, cell: { x: number; y: number }): SimEvent[] {
  sim.enqueue({ type: 'moveTower', towerId: tower.id, x: cell.x, y: cell.y });
  return stepOnce(sim);
}

function run(sim: Simulation, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...stepOnce(sim));
  return events;
}

const at = (t: Tower) => ({ x: t.x, y: t.y });

/** Tudo da torre menos a casa. */
const withoutCell = (t: Tower) => {
  const rest: Partial<Tower> = { ...t };
  delete rest.x;
  delete rest.y;
  return rest;
};

// ---------------------------------------------------------------------------
// Mover e trocar
// ---------------------------------------------------------------------------

describe('mover fora da onda', () => {
  it('vai para a casa livre, de graça, e emite towerMoved', () => {
    const { sim } = moveSim();
    const t = put(sim, 'mortar', A);
    const gold = sim.state.gold;
    const events = move(sim, t, C);
    expect(at(t)).toEqual(C);
    expect(sim.state.gold).toBe(gold);
    expect(ofType(events, 'towerMoved')).toEqual([
      {
        type: 'towerMoved',
        tick: sim.state.tick,
        towerId: t.id,
        fromX: A.x,
        fromY: A.y,
        x: C.x,
        y: C.y,
        swappedWithId: null,
      },
    ]);
    expect(ofType(events, 'moveRefused')).toEqual([]);
  });

  it('soltar sobre outra torre troca as duas; a ordem de disparo não muda', () => {
    const { sim } = moveSim();
    const a = put(sim, 'mortar', A);
    const b = put(sim, 'relay', B);
    const order = sim.state.towers.map((t) => t.id);
    const events = move(sim, a, B);
    expect(at(a)).toEqual(B);
    expect(at(b)).toEqual(A);
    expect(sim.state.towers.map((t) => t.id)).toEqual(order);
    expect(ofType(events, 'towerMoved')).toEqual([
      expect.objectContaining({ towerId: a.id, fromX: A.x, fromY: A.y, ...B, swappedWithId: b.id }),
    ]);
  });

  it('a torre leva todo o estado junto (igual à mesma partida sem mover, menos a casa)', () => {
    const setup = () => {
      const { sim } = moveSim('estado');
      const t = put(sim, 'obelisk', A);
      const other = put(sim, 'relay', B);
      for (const tower of [t, other]) {
        Object.assign(tower, {
          star: 2,
          invested: 37,
          cooldownTicks: 50,
          triggerCounter: 2,
          charges: 1,
          activationReadyTick: 999,
          lastEffect: { effect: { kind: 'explosion', radius: 1, damagePercent: 50 }, seq: 7 },
        });
      }
      return { sim, t, other };
    };
    const moved = setup();
    const control = setup();
    move(moved.sim, moved.t, C);
    stepOnce(control.sim);
    expect(withoutCell(moved.t)).toEqual(withoutCell(control.t));
    expect(moved.sim.state.towers[0]).toBe(moved.t); // o mesmo objeto, no mesmo lugar da lista

    // Na troca, as duas levam o próprio estado.
    const swapped = setup();
    const control2 = setup();
    move(swapped.sim, swapped.t, B);
    stepOnce(control2.sim);
    expect(withoutCell(swapped.t)).toEqual(withoutCell(control2.t));
    expect(withoutCell(swapped.other)).toEqual(withoutCell(control2.other));
  });

  it('casa inválida (caminho, núcleo, fora do mapa, fracionária) é recusada sem mudar nada', () => {
    const { sim } = moveSim();
    const t = put(sim, 'mortar', A);
    const before = serializeRunState(sim.state as RunState);
    for (const cell of [
      PATH,
      smallMap.nexus,
      smallMap.entrance,
      { x: -1, y: 0 },
      { x: 99, y: 0 },
    ]) {
      const events = move(sim, t, cell);
      expect(at(t)).toEqual(A);
      expect(ofType(events, 'moveRefused')).toEqual([
        { type: 'moveRefused', tick: sim.state.tick, towerId: t.id, reason: 'invalid' },
      ]);
    }
    expect(ofType(move(sim, t, { x: 0.5, y: 0 }), 'moveRefused')).toHaveLength(1);
    expect(at(t)).toEqual(A);
    // Só o relógio andou.
    const after = JSON.parse(serializeRunState(sim.state as RunState)) as RunState;
    const reference = JSON.parse(before) as RunState;
    expect(after.towers).toEqual(reference.towers);
    expect(after.gold).toBe(reference.gold);
  });

  it('soltar na própria casa ou mover torre que não existe: nada acontece, sem evento', () => {
    const { sim } = moveSim();
    const t = put(sim, 'mortar', A);
    const same = move(sim, t, A);
    expect(ofType(same, 'towerMoved')).toEqual([]);
    expect(ofType(same, 'moveRefused')).toEqual([]);
    sim.enqueue({ type: 'moveTower', towerId: 9999, x: C.x, y: C.y });
    const ghost = stepOnce(sim);
    expect(ofType(ghost, 'towerMoved')).toEqual([]);
    expect(ofType(ghost, 'moveRefused')).toEqual([]);
    expect(at(t)).toEqual(A);
  });

  it('move e troca várias vezes no mesmo tick, na ordem da fila', () => {
    const { sim } = moveSim();
    const a = put(sim, 'mortar', A);
    const b = put(sim, 'relay', B);
    sim.enqueue({ type: 'moveTower', towerId: a.id, ...C });
    sim.enqueue({ type: 'moveTower', towerId: b.id, ...C }); // troca com a, que já está em C
    const events = stepOnce(sim);
    expect(at(a)).toEqual(B);
    expect(at(b)).toEqual(C);
    expect(ofType(events, 'towerMoved').map((e) => e.swappedWithId)).toEqual([null, a.id]);
  });
});

// ---------------------------------------------------------------------------
// Trava durante a onda
// ---------------------------------------------------------------------------

describe('trava com onda ativa', () => {
  it('recusa com uma onda ativa (evento locked) e libera quando ela fecha', () => {
    const { sim, control } = moveSim();
    const t = put(sim, 'mortar', A);
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(towersLocked(sim.state)).toBe(true);
    const events = move(sim, t, C);
    expect(at(t)).toEqual(A);
    expect(ofType(events, 'moveRefused')).toEqual([
      { type: 'moveRefused', tick: sim.state.tick, towerId: t.id, reason: 'locked' },
    ]);
    expect(ofType(events, 'towerMoved')).toEqual([]);

    control.kill = () => true;
    const closing = run(sim, 40);
    expect(ofType(closing, 'waveEnded')).toHaveLength(1);
    expect(towersLocked(sim.state)).toBe(false);
    expect(ofType(move(sim, t, C), 'towerMoved')).toHaveLength(1);
    expect(at(t)).toEqual(C);
  });

  it('a recusa vale também para a troca e para casa inválida (a trava vem primeiro)', () => {
    const { sim } = moveSim();
    const a = put(sim, 'mortar', A);
    const b = put(sim, 'relay', B);
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(ofType(move(sim, a, B), 'moveRefused')[0]?.reason).toBe('locked');
    expect(ofType(move(sim, a, PATH), 'moveRefused')[0]?.reason).toBe('locked');
    expect(at(a)).toEqual(A);
    expect(at(b)).toEqual(B);
  });

  it('com ondas empilhadas, trava até a última fechar', () => {
    const { sim, control } = moveSim();
    const t = put(sim, 'mortar', A);
    for (let i = 0; i < 3; i++) sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(sim.state.waves.active.map((w) => w.wave)).toEqual([1, 2, 3]);
    expect(ofType(move(sim, t, C), 'moveRefused')[0]?.reason).toBe('locked');

    // Fecha as ondas 1 e 2; a 3 continua: ainda travado.
    control.kill = (e) => e.wave <= 2;
    run(sim, 40);
    expect(sim.state.waves.active.map((w) => w.wave)).toEqual([3]);
    expect(ofType(move(sim, t, C), 'moveRefused')[0]?.reason).toBe('locked');

    control.kill = () => true;
    run(sim, 40);
    expect(sim.state.waves.active).toEqual([]);
    expect(ofType(move(sim, t, C), 'towerMoved')).toHaveLength(1);
  });

  it('a onda limpa esperando a anterior fechar também trava', () => {
    const { sim, control } = moveSim();
    const t = put(sim, 'mortar', A);
    sim.enqueue({ type: 'callWave' });
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    control.kill = (e) => e.wave === 2; // a onda 2 limpa, a 1 continua
    run(sim, 40);
    control.kill = () => false;
    const wave2 = sim.state.waves.active.find((w) => w.wave === 2)!;
    expect(wave2.spawned).toBe(1);
    expect(sim.state.waves.active.map((w) => w.wave)).toEqual([1, 2]);

    // A onda 2 já está limpa, mas continua na lista esperando a 1: segue travado.
    expect(ofType(move(sim, t, C), 'moveRefused')[0]?.reason).toBe('locked');
    control.kill = () => true;
    const closing = run(sim, 40);
    expect(ofType(closing, 'waveEnded').map((e) => e.wave)).toEqual([1, 2]);
    expect(ofType(move(sim, t, C), 'towerMoved')).toHaveLength(1);
  });

  it('inimigos do debug sem onda não travam', () => {
    const { sim } = moveSim();
    const t = put(sim, 'mortar', A);
    sim.enqueue({ type: 'debugSpawnEnemies', count: 5, enemyType: 'slow', layout: 'spread' });
    stepOnce(sim);
    expect(sim.state.enemies.activeCount).toBe(5);
    expect(towersLocked(sim.state)).toBe(false);
    expect(ofType(move(sim, t, C), 'towerMoved')).toHaveLength(1);
  });

  it('a regra pura: travado se e só se houver onda na lista ativa', () => {
    const state = makeState();
    expect(towersLocked(state)).toBe(false);
    state.waves.active.push({ wave: 1, startTick: 0, spawned: 0, bossesKilled: 0, earlyBonus: 0 });
    expect(towersLocked(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comprar, fundir e vender continuam liberados durante a onda
// ---------------------------------------------------------------------------

describe('durante a onda, só mover trava', () => {
  it('comprar e posicionar, fundir e vender funcionam com onda ativa', () => {
    const sim = shopSim('onda-livre');
    const [c0, c1] = freeCells(2);
    sim.enqueue({ type: 'callWave' });
    stepOnce(sim);
    expect(sim.state.waves.active).toHaveLength(1);
    sim.state.gold = 100;

    // Compra que posiciona.
    sim.state.shop.slots[0] = 'mortar';
    sim.enqueue({ type: 'buyTower', slot: 0, ...c0! });
    const bought = stepOnce(sim);
    expect(ofType(bought, 'towerBought')).toEqual([expect.objectContaining({ fused: false })]);
    const tower = sim.state.towers.find((t) => t.x === c0!.x && t.y === c0!.y)!;

    // Compra que funde.
    sim.state.shop.slots[1] = 'mortar';
    sim.enqueue({ type: 'buyTower', slot: 1 });
    const fused = stepOnce(sim);
    expect(ofType(fused, 'towersMerged')).toHaveLength(1);
    expect(tower.star).toBe(2);

    // Mover a mesma torre: recusado.
    sim.enqueue({ type: 'moveTower', towerId: tower.id, ...c1! });
    expect(ofType(stepOnce(sim), 'moveRefused')[0]?.reason).toBe('locked');

    // Vender.
    const gold = sim.state.gold;
    sim.enqueue({ type: 'sellTower', towerId: tower.id });
    const sold = stepOnce(sim);
    expect(ofType(sold, 'towerSold')).toHaveLength(1);
    expect(sim.state.towers).toEqual([]);
    expect(sim.state.gold).toBeGreaterThan(gold);
    expect(sim.state.waves.active).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Vizinhança e bônus depois de mover
// ---------------------------------------------------------------------------

describe('vizinhança depois de mover', () => {
  const bigMap = loadMap({
    id: 'aberto',
    width: 12,
    height: 12,
    path: [
      { x: 0, y: 11 },
      { x: 11, y: 11 },
    ],
  });
  const idle = (tower: Tower): Tower => {
    tower.cooldownTicks = 1e6;
    return tower;
  };

  /** Relé (Arcana) em (5,5) com uma vizinha na diagonal; `to` = para onde ela vai no tick 1. */
  function activations(arcaneLevel: number, to: { x: number; y: number } | null): number {
    const state = makeState();
    state.classes.arcane!.level = arcaneLevel;
    const neighbor = idle(addTower(state, 'arrow', 6, 6));
    addTower(state, 'relay', 5, 5);
    place(state, 'brick', 5, 5, 1e9);
    const mover: System = (ctx) => {
      if (to && ctx.state.tick === 1) moveTower(ctx, bigMap, neighbor.id, to);
    };
    const sim = triggerSim(state, undefined, [mover]);
    sim.step();
    return ofType(sim.drainEvents(), 'towerActivated').length;
  }

  it('Arcana: o Relé ativa a vizinha na diagonal e perde a vizinha quando ela é movida para longe', () => {
    expect(activations(1, null)).toBe(1);
    expect(activations(1, { x: 8, y: 8 })).toBe(0);
    // E ganha de volta quem chega ao lado.
    expect(activations(0, null)).toBe(0); // sem Arcana, diagonal não é vizinha
    expect(activations(0, { x: 5, y: 6 })).toBe(1);
  });

  it('o bônus de classe é recalculado no tick seguinte (mover não muda a contagem de tipos)', () => {
    const sim = shopSim('classe');
    const [c0, c1, c2] = freeCells(3);
    sim.enqueue({ type: 'placeTower', towerType: 'relay', ...c0! });
    sim.enqueue({ type: 'placeTower', towerType: 'obelisk', ...c1! });
    stepOnce(sim);
    expect(sim.state.classes.arcane!.level).toBe(1);
    const relay = sim.state.towers[0]!;
    sim.enqueue({ type: 'moveTower', towerId: relay.id, ...c2! });
    const events = stepOnce(sim);
    expect(ofType(events, 'towerMoved')).toHaveLength(1);
    expect(ofType(events, 'classLevelChanged')).toEqual([]);
    expect(sim.state.classes.arcane!.level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinismo e save
// ---------------------------------------------------------------------------

describe('determinismo e save', () => {
  function scripted(seed: string) {
    const sim = shopSim(seed);
    const cells = freeCells(4);
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: 3,
      towerTypes: ['relay', 'mortar', 'obelisk'],
      layout: 'clustered',
    });
    stepOnce(sim);
    const [a, b] = sim.state.towers;
    sim.enqueue({ type: 'moveTower', towerId: a!.id, x: b!.x, y: b!.y });
    sim.enqueue({ type: 'moveTower', towerId: b!.id, ...cells[3]! });
    stepOnce(sim);
    return sim;
  }

  it('a mesma semente e os mesmos comandos dão o mesmo estado', () => {
    const one = scripted('det');
    const two = scripted('det');
    for (const sim of [one, two]) {
      sim.enqueue({ type: 'callWave' });
      run(sim, 200);
    }
    expect(serializeRunState(one.state as RunState)).toBe(serializeRunState(two.state as RunState));
  });

  it('salvar logo depois de um movimento e retomar dá o mesmo resultado', () => {
    const sim = scripted('save');
    const json = serializeRunState(sim.state as RunState);
    const restored = Simulation.restore(json, createGameSystems(realMap));
    for (const s of [sim, restored]) {
      s.enqueue({ type: 'callWave' });
      run(s, 300);
    }
    expect(serializeRunState(restored.state as RunState)).toBe(
      serializeRunState(sim.state as RunState),
    );
  });

  it('um moveTower ainda na fila vai no save e é aplicado depois de retomar', () => {
    const sim = shopSim('fila');
    const [c0, c1] = freeCells(2);
    sim.enqueue({ type: 'placeTower', towerType: 'mortar', ...c0! });
    stepOnce(sim);
    const id = sim.state.towers[0]!.id;
    sim.enqueue({ type: 'moveTower', towerId: id, ...c1! });
    const restored = Simulation.restore(
      serializeRunState(sim.state as RunState),
      createGameSystems(realMap),
    );
    const events = stepOnce(restored);
    expect(ofType(events, 'towerMoved')).toHaveLength(1);
    expect(at(restored.state.towers[0]!)).toEqual(c1);
  });
});
