import { describe, expect, it } from 'vitest';
import debugConfig from '../src/data/debug.json';
import classesJson from '../src/data/classes.json';
import mapData from '../src/data/map.json';
import towersJson from '../src/data/towers.json';
import { killWeight, neighborhoodRadius, reducedTriggerCount } from '../src/sim/classes/bonuses';
import { classData, loadClassData } from '../src/sim/classes/classData';
import type { SimEvent } from '../src/sim/engine/events';
import { Simulation, type System } from '../src/sim/engine/simulation';
import { loadMap } from '../src/sim/grid/map';
import { deserializeRunState, type DebugLayout, type RunState } from '../src/sim/state';
import { createGameSystems } from '../src/sim/systems';
import { loadTowerData, type TowerData, type TowerType } from '../src/sim/towers/towerData';
import { TPS, blindNexus, makeState, place, smallMap, testEnemies } from './support/enemySim';
import { addTower, run, testTowers } from './support/towerSim';
import {
  armedType,
  factsAt,
  killFact,
  ofType,
  triggerData,
  triggerSim,
} from './support/triggerSim';
import { buildClassRows } from '../src/ui/classPanelModel';

const CLASS_IDS = classData.ids;

/** Liga o nível `level` (0 = nenhum, 1 = "nível 2", 2 = "nível 4") das classes pedidas. */
function setLevels(state: RunState, levels: Record<string, number>): void {
  for (const [id, level] of Object.entries(levels)) state.classes[id]!.level = level;
}

/** Torre de teste com as classes pedidas (a Flecha com outras classes). */
function classed(classes: [string, string], base: Partial<TowerType> = {}): TowerType {
  return { ...testTowers.types.arrow!, classes, ...base };
}

/** Dados de teste: o `triggerData` + tipos extras. */
function withTypes(extra: Record<string, TowerType>): TowerData {
  const data = triggerData();
  return { ...data, types: { ...data.types, ...extra } };
}

const idle = <T extends { cooldownTicks: number }>(tower: T): T => {
  tower.cooldownTicks = 1e6;
  return tower;
};

// ---------------------------------------------------------------------------
// Contagem
// ---------------------------------------------------------------------------

/** Tipos de teste sem gatilho: 4 por classe, para chegar ao nível 4. */
const countTypes: Record<string, TowerType> = {
  a1: classed(['artillery', 'arcane']),
  a2: classed(['artillery', 'mechanical']),
  a3: classed(['artillery', 'shadow']),
  a4: classed(['artillery', 'arcane']),
  m1: classed(['mechanical', 'shadow']),
  m2: classed(['mechanical', 'arcane']),
  s1: classed(['shadow', 'arcane']),
};
const countTowers: TowerData = {
  ...testTowers,
  types: { ...testTowers.types, ...countTypes },
};

/** Casas livres do mapa pequeno (fora do caminho). */
const FREE = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 1 },
  { x: 0, y: 2 },
  { x: 1, y: 2 },
];

function countingSim(): { sim: Simulation; levels: string[]; state: RunState } {
  const systems = createGameSystems(smallMap, {
    enemies: testEnemies,
    nexus: blindNexus,
    towers: countTowers,
    ticksPerSecond: TPS,
  });
  // Sonda antes do sistema de classes: o que o resto do tick enxergou.
  const levels: string[] = [];
  const probe: System = (ctx) => {
    levels.push(CLASS_IDS.map((id) => ctx.state.classes[id]!.level).join(''));
  };
  systems.splice(systems.length - 1, 0, probe);
  const state = makeState('count', blindNexus);
  return { sim: new Simulation(state, systems), levels, state };
}

function placeTypes(sim: Simulation, types: string[]): void {
  types.forEach((towerType, i) => sim.enqueue({ type: 'placeTower', towerType, ...FREE[i]! }));
}

const levelsOf = (state: RunState): Record<string, number> =>
  Object.fromEntries(CLASS_IDS.map((id) => [id, state.classes[id]!.level]));
const countsOf = (state: RunState): Record<string, number> =>
  Object.fromEntries(CLASS_IDS.map((id) => [id, state.classes[id]!.members.length]));

describe('contagem de classes', () => {
  it('sem torres, todas as classes ficam com 0 e sem nível', () => {
    const { sim } = countingSim();
    run(sim, 3);
    expect(countsOf(sim.state)).toEqual({ artillery: 0, mechanical: 0, arcane: 0, shadow: 0 });
    expect(levelsOf(sim.state)).toEqual({ artillery: 0, mechanical: 0, arcane: 0, shadow: 0 });
  });

  it('as duas classes de cada torre contam, e 1 torre não basta para o nível 2', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1']); // Artilharia + Arcana
    run(sim, 2);
    expect(countsOf(sim.state)).toEqual({ artillery: 1, mechanical: 0, arcane: 1, shadow: 0 });
    expect(levelsOf(sim.state)).toEqual({ artillery: 0, mechanical: 0, arcane: 0, shadow: 0 });
  });

  it('torres diferentes: 2 dão o nível 2 e 4 dão o nível 4 (níveis vêm dos dados)', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1', 'a2']);
    run(sim, 2);
    expect(countsOf(sim.state).artillery).toBe(2);
    expect(sim.state.classes.artillery!.level).toBe(1);

    placeTypes(sim, []);
    sim.enqueue({ type: 'placeTower', towerType: 'a3', ...FREE[2]! });
    sim.enqueue({ type: 'placeTower', towerType: 'a4', ...FREE[3]! });
    run(sim, 2);
    expect(countsOf(sim.state).artillery).toBe(4);
    expect(sim.state.classes.artillery!.level).toBe(2);
    // Arcana: a1, a4 → 2; Sombria: a3 → 1; Mecânica: a2 → 1.
    expect(levelsOf(sim.state)).toEqual({ artillery: 2, mechanical: 0, arcane: 1, shadow: 0 });
  });

  it('cópias não somam: 5 torres do mesmo tipo contam 1', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1', 'a1', 'a1', 'a1', 'a1']);
    run(sim, 2);
    expect(sim.state.towers).toHaveLength(5);
    expect(countsOf(sim.state)).toEqual({ artillery: 1, mechanical: 0, arcane: 1, shadow: 0 });
    expect(sim.state.classes.artillery!.members).toEqual(['a1']);
  });

  it('liga no tick seguinte a posicionar (o resto do tick ainda enxerga o valor antigo)', () => {
    const { sim, levels } = countingSim();
    run(sim, 2);
    placeTypes(sim, ['a1', 'a2']); // entram no início do tick 3
    run(sim, 2);
    // Sonda por tick: 1 e 2 sem nível; no tick 3 a torre já existe, mas o bônus só vale no 4.
    expect(levels).toEqual(['0000', '0000', '0000', '1000']);
    expect(sim.state.classes.artillery!.level).toBe(1);
  });

  it('desliga no tick seguinte a vender; vender uma cópia não reduz o bônus', () => {
    const { sim, levels, state } = countingSim();
    placeTypes(sim, ['a1', 'a2', 'a2']);
    run(sim, 2);
    expect(sim.state.classes.artillery!.level).toBe(1);

    // "Fundir" cópias: sai uma a2 e a outra fica. A contagem não muda.
    const copy = sim.state.towers.filter((t) => t.type === 'a2').at(-1)!;
    state.towers = state.towers.filter((t) => t !== copy);
    run(sim, 2);
    expect(sim.state.classes.artillery!.level).toBe(1);

    // Vender a última a2: o tipo some do mapa e o nível cai.
    state.towers = state.towers.filter((t) => t.type !== 'a2');
    levels.length = 0;
    const events = run(sim, 2);
    expect(levels).toEqual(['1000', '0000']); // o tick da venda ainda enxerga o nível 1
    expect(sim.state.classes.artillery!.level).toBe(0);
    expect(
      ofType(events, 'classLevelChanged').map((e) => `${e.classId}:${e.previousLevel}->${e.level}`),
    ).toEqual(['artillery:1->0']);
  });

  it('emite classLevelChanged só quando o nível muda', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1', 'a2', 'a3']);
    const events = run(sim, 3);
    const changes = ofType(events, 'classLevelChanged').map(
      (e) => `${e.classId}:${e.previousLevel}->${e.level}(${e.count})`,
    );
    expect(changes).toEqual(['artillery:0->1(3)']);
  });

  it('com dados de teste, o nível 4 de todas as classes liga com 4 torres diferentes', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1', 'a2', 'a3', 'a4', 'm1', 'm2', 's1']);
    run(sim, 2);
    // Arcana: a1, a4, m2, s1. Mecânica: a2, m1, m2 (3). Sombria: a3, m1, s1 (3).
    expect(countsOf(sim.state)).toEqual({ artillery: 4, mechanical: 3, arcane: 4, shadow: 3 });
    expect(levelsOf(sim.state)).toEqual({ artillery: 2, mechanical: 1, arcane: 2, shadow: 1 });
  });

  it('o painel mostra "Arcana 3/4", destaca o nível ativo e lista as torres', () => {
    const { sim } = countingSim();
    placeTypes(sim, ['a1', 'a4', 'm2']); // Arcana 3
    run(sim, 2);
    const rows = buildClassRows(sim.state.classes, classData, countTowers);
    const arcane = rows.find((r) => r.id === 'arcane')!;
    expect(arcane.label).toBe('Arcana 3/4');
    expect(arcane.level).toBe(1);
    expect(arcane.levels.map((l) => [l.count, l.active])).toEqual([
      [2, true],
      [4, false],
    ]);
    expect(arcane.members).toEqual(['Flecha', 'Flecha', 'Flecha']);
    expect(rows.find((r) => r.id === 'shadow')!.label).toBe('Sombria 0/2');
    expect(rows.find((r) => r.id === 'artillery')!.label).toBe('Artilharia 2/4');
  });

  it('o painel mostra "máx." depois do último nível', () => {
    const state = makeState();
    state.classes.arcane = { level: 2, members: ['a', 'b', 'c', 'd', 'e'] };
    const row = buildClassRows(state.classes, classData, countTowers).find(
      (r) => r.id === 'arcane',
    )!;
    expect(row.label).toBe('Arcana 5 · máx.');
    expect(row.next).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Artilharia
// ---------------------------------------------------------------------------

describe('bônus da Artilharia', () => {
  /** Tiro em área: dois alvos, um no ponto de impacto e outro a 0,9 dele. */
  function blast(level: number, bombType = 'bomb') {
    const state = makeState();
    setLevels(state, { artillery: level });
    addTower(state, bombType, 0, 0);
    const near = place(state, 'brick', 1, 0, 1e9);
    const off = place(state, 'brick', 1, 0.9, 1e9);
    const events = run(triggerSim(state), 6);
    return {
      radius: ofType(events, 'areaExploded')[0]!.radius,
      nearLoss: 1e9 - near.hp,
      offLoss: 1e9 - off.hp,
    };
  }

  it('tiro em área: raio ×1,25 no nível 2 e ×1,5 com dano +25% no nível 4', () => {
    expect(blast(0)).toEqual({ radius: 0.75, nearLoss: 4, offLoss: 0 });
    expect(blast(1)).toEqual({ radius: 0.9375, nearLoss: 4, offLoss: 4 });
    expect(blast(2)).toEqual({ radius: 1.125, nearLoss: 5, offLoss: 5 });
  });

  it('só vale para torres da classe: a mesma bomba sem Artilharia não muda', () => {
    const state = makeState();
    setLevels(state, { artillery: 2 });
    const data = withTypes({
      plain: classed(['mechanical', 'shadow'], { shot: { kind: 'area', radius: 0.75 } }),
    });
    addTower(state, 'plain', 0, 0);
    place(state, 'brick', 1, 0, 1e9);
    const events = run(triggerSim(state, data), 6);
    expect(ofType(events, 'areaExploded')[0]!.radius).toBe(0.75);
  });

  it('tiro único não ganha nada (o bônus é da área)', () => {
    const state = makeState();
    setLevels(state, { artillery: 2 });
    const data = withTypes({ sniper: classed(['artillery', 'shadow']) });
    addTower(state, 'sniper', 0, 0);
    const target = place(state, 'brick', 1, 0, 1e9);
    run(triggerSim(state, data), 6);
    expect(1e9 - target.hp).toBe(6); // dano base da Flecha, sem +25%
  });

  it('explosão de gatilho (Ceifador): raio e dano nos dois níveis; o clarão usa o raio novo', () => {
    const data = withTypes({
      artReaper: armedType(
        'enemyDiesInRange',
        'explosion',
        { radius: 0.5, damagePercent: 50 },
        { classes: ['shadow', 'artillery'] },
      ),
    });
    const explode = (level: number, type: string) => {
      const state = makeState();
      setLevels(state, { artillery: level });
      idle(addTower(state, type, 0, 0));
      const inside = place(state, 'brick', 1.5, 0, 1e9); // a 0,5 do ponto da morte
      const edge = place(state, 'brick', 1.7, 0, 1e9); // a 0,7
      const events = run(triggerSim(state, data, [factsAt(1, [killFact(1, 0, 9)])]), 1);
      return {
        radius: ofType(events, 'areaExploded')[0]!.radius,
        inside: 1e9 - inside.hp,
        edge: 1e9 - edge.hp,
      };
    };
    expect(explode(0, 'artReaper')).toEqual({ radius: 0.5, inside: 3, edge: 0 });
    expect(explode(1, 'artReaper')).toEqual({ radius: 0.625, inside: 3, edge: 0 });
    expect(explode(2, 'artReaper')).toEqual({ radius: 0.75, inside: 3.75, edge: 3.75 });
    // O mesmo gatilho numa torre sem Artilharia não muda.
    expect(explode(2, 'reaper')).toEqual({ radius: 0.5, inside: 3, edge: 0 });
  });

  it('a linha perfurante (Balista) fica fora do bônus', () => {
    const data = withTypes({
      artPiercer: armedType(
        'onFire',
        'pierceLine',
        { halfWidth: 0.25, damagePercent: 100 },
        { range: 2, classes: ['artillery', 'mechanical'] },
      ),
    });
    const loss = (level: number) => {
      const state = makeState();
      setLevels(state, { artillery: level });
      addTower(state, 'artPiercer', 0, 0);
      const on = place(state, 'brick', 1, 0, 1e9);
      const side = place(state, 'brick', 1, 0.4, 1e9); // fora da meia-largura de 0,25
      run(triggerSim(state, data), 1);
      return [1e9 - on.hp, 1e9 - side.hp];
    };
    expect(loss(0)).toEqual([6, 0]);
    expect(loss(2)).toEqual([6, 0]);
  });

  it('tiros extras do disparo múltiplo (Morteiro) também usam o raio novo', () => {
    const data = withTypes({
      artMulti: armedType(
        'everyNShots',
        'multiShot',
        { shots: 1, extraShots: 1 },
        { classes: ['artillery', 'mechanical'], shot: { kind: 'area', radius: 0.75 } },
      ),
    });
    const state = makeState();
    setLevels(state, { artillery: 2 });
    addTower(state, 'artMulti', 0, 0);
    place(state, 'brick', 1, 0, 1e9);
    const blasts = ofType(run(triggerSim(state, data), 6), 'areaExploded');
    expect(blasts.length).toBeGreaterThanOrEqual(2);
    expect(blasts.every((b) => b.radius === 1.125)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mecânica
// ---------------------------------------------------------------------------

describe('bônus da Mecânica', () => {
  const mech = classed(['mechanical', 'arcane']);
  const other = classed(['artillery', 'shadow']);
  const levelState = (level: number) => {
    const state = makeState();
    setLevels(state, { mechanical: level });
    return state;
  };

  it('arredonda para baixo: Morteiro 5 → 4 → 3 e Relógio 10 → 8 → 6', () => {
    const counts = (base: number) =>
      [0, 1, 2].map((level) => reducedTriggerCount(classData, levelState(level), mech, base));
    expect(counts(5)).toEqual([5, 4, 3]);
    expect(counts(10)).toEqual([10, 8, 6]);
  });

  it('tem mínimo 2 (dos dados) e nunca aumenta o N', () => {
    const at = (level: number, base: number) =>
      reducedTriggerCount(classData, levelState(level), mech, base);
    expect(at(2, 3)).toBe(2); // 3 × 0,6 = 1,8 → 1 → mínimo 2
    expect(at(2, 2)).toBe(2);
    expect(at(1, 2)).toBe(2); // 2 × 0,8 = 1,6 → 1 → mínimo 2
    expect(at(2, 1)).toBe(1); // N já abaixo do mínimo: não sobe
    const raised = loadClassData({ ...classesJson, minTriggerCount: 4 });
    expect(reducedTriggerCount(raised, levelState(2), mech, 5)).toBe(4);
  });

  it('só vale para torres Mecânica', () => {
    expect(reducedTriggerCount(classData, levelState(2), other, 5)).toBe(5);
  });

  it('"a cada N tiros": o gatilho completa em 5, 4 e 3 tiros nos níveis 0, 2 e 4', () => {
    const data = withTypes({
      mortar: armedType('everyNShots', 'multiShot', { shots: 5, extraShots: 1 }),
    });
    const shotsUntilFire = (level: number): number => {
      const state = levelState(level);
      const t = idle(addTower(state, 'mortar', 0, 0));
      const shots = Array.from({ length: 6 }, (_, i) =>
        factsAt(i + 1, [
          { type: 'towerFired', tick: 0, towerId: t.id, targetId: 1, shot: 'normal' },
        ]),
      );
      const events = run(triggerSim(state, data, shots), 6);
      return ofType(events, 'triggerFired')[0]!.tick;
    };
    expect([0, 1, 2].map(shotsUntilFire)).toEqual([5, 4, 3]);
  });

  it('"a cada N abates": Relógio 10 → 8 → 6 (abate de qualquer autor)', () => {
    const data = withTypes({
      clock: armedType('everyNKillsInRange', 'explosion', {
        kills: 10,
        radius: 0.5,
        damagePercent: 100,
      }),
    });
    const killsUntilFire = (level: number): number => {
      const state = levelState(level);
      idle(addTower(state, 'clock', 0, 0));
      const kills = Array.from({ length: 10 }, (_, i) => factsAt(i + 1, [killFact(1, 0, 9)]));
      const events = run(triggerSim(state, data, kills), 10);
      return ofType(events, 'triggerFired')[0]!.tick;
    };
    expect([0, 1, 2].map(killsUntilFire)).toEqual([10, 8, 6]);
  });

  it('contador acima do novo N: completa no próximo fato, não dispara sozinho', () => {
    const data = withTypes({
      mortar: armedType('everyNShots', 'multiShot', { shots: 5, extraShots: 1 }),
    });
    const state = levelState(2); // N passa de 5 para 3
    const t = idle(addTower(state, 'mortar', 0, 0));
    t.triggerCounter = 4; // já passou do novo N
    const sim = triggerSim(state, data, [
      factsAt(3, [{ type: 'towerFired', tick: 0, towerId: t.id, targetId: 1, shot: 'normal' }]),
    ]);
    expect(ofType(run(sim, 2), 'triggerFired')).toEqual([]); // ticks 1 e 2, sem fato
    expect(t.triggerCounter).toBe(4);
    expect(ofType(run(sim, 1), 'triggerFired')).toHaveLength(1); // o próximo fato completa
    expect(t.triggerCounter).toBe(2); // 5 − 3
  });

  it('classe dupla: uma torre Mecânica + Sombria recebe o bônus da Mecânica', () => {
    const dual = classed(['shadow', 'mechanical']);
    expect(reducedTriggerCount(classData, levelState(1), dual, 5)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Arcana
// ---------------------------------------------------------------------------

describe('bônus da Arcana', () => {
  const arcane = classed(['arcane', 'shadow']);

  it('raio da vizinhança: 0 sem bônus, 1 no nível 2 e 2 no nível 4; só para Arcana', () => {
    const at = (level: number, type: TowerType) => {
      const state = makeState();
      setLevels(state, { arcane: level });
      return neighborhoodRadius(classData, state, type);
    };
    expect([0, 1, 2].map((l) => at(l, arcane))).toEqual([0, 1, 2]);
    expect(at(2, classed(['artillery', 'mechanical']))).toBe(0);
  });

  /** Relé no centro de um bloco 5×5 de torres paradas; devolve as ativações do 1º disparo. */
  function relayActivations(level: number): number {
    const state = makeState();
    setLevels(state, { arcane: level });
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx !== 0 || dy !== 0) idle(addTower(state, 'arrow', 5 + dx, 5 + dy));
      }
    }
    addTower(state, 'relay', 5, 5);
    place(state, 'brick', 5, 5, 1e9);
    const events = run(triggerSim(state), 1);
    return ofType(events, 'towerActivated').length;
  }

  it('Relé: 4 vizinhas sem bônus, 8 no nível 2 e 24 no nível 4 (sem o teto de 4)', () => {
    expect([0, 1, 2].map(relayActivations)).toEqual([4, 8, 24]);
  });

  it('Relé sem Arcana continua com o teto dos dados', () => {
    const state = makeState();
    setLevels(state, { arcane: 2 });
    const data = withTypes({
      mechRelay: armedType(
        'onFire',
        'activateNeighbors',
        { maxTargets: 4 },
        { classes: ['mechanical', 'shadow'] },
      ),
    });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [2, 0],
    ] as const) {
      idle(addTower(state, 'arrow', 5 + dx, 5 + dy));
    }
    addTower(state, 'mechRelay', 5, 5);
    place(state, 'brick', 5, 5, 1e9);
    expect(ofType(run(triggerSim(state, data), 1), 'towerActivated')).toHaveLength(4);
  });

  it('as ativadas respeitam a ordem de id e a trava de 1 s continua valendo', () => {
    const state = makeState();
    setLevels(state, { arcane: 1 });
    const ring = [
      [1, 1],
      [0, 1],
      [-1, 1],
      [1, 0],
      [-1, 0],
      [1, -1],
      [0, -1],
      [-1, -1],
    ] as const;
    const towers = ring.map(([dx, dy]) => idle(addTower(state, 'arrow', 5 + dx, 5 + dy)));
    addTower(state, 'relay', 5, 5);
    place(state, 'brick', 5, 5, 1e9);
    const events = run(triggerSim(state), 8);
    const first = ofType(events, 'towerActivated').filter((e) => e.tick === 1);
    expect(first.map((e) => e.towerId)).toEqual(towers.map((t) => t.id));
    // O Relé atira de novo a cada 5 ticks (1,5 tiro/s a 8 ticks/s), mas as vizinhas estão na trava.
    expect(ofType(events, 'towerActivated').every((e) => e.tick === 1)).toBe(true);
  });

  it('loop entre Relés vizinhos com vizinhança de 8: contido pela trava de ativação', () => {
    const state = makeState();
    setLevels(state, { arcane: 2 });
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [5, 6],
      [6, 6],
    ] as const)
      addTower(state, 'echo', x, y);
    place(state, 'brick', 5, 5, 1e9);
    const sim = triggerSim(state);
    const events = run(sim, 40);
    // Cada torre só é ativada 1 vez a cada 8 ticks: no máximo 5 ativações em 40 ticks.
    for (const t of state.towers) {
      expect(
        ofType(events, 'towerActivated').filter((e) => e.towerId === t.id).length,
      ).toBeLessThanOrEqual(5);
    }
    expect(state.triggers.droppedTotal).toBe(0);
  });

  it('"vizinha abate" (Obelisco) usa a vizinhança da própria Arcana', () => {
    const chargesAfterKill = (level: number, dx: number, dy: number): number => {
      const state = makeState();
      setLevels(state, { arcane: level });
      const obelisk = idle(addTower(state, 'obelisk', 5, 5));
      const killer = idle(addTower(state, 'arrow', 5 + dx, 5 + dy));
      run(triggerSim(state, triggerData(), [factsAt(1, [killFact(5, 5, killer.id)])]), 1);
      return obelisk.charges;
    };
    expect([0, 1, 2].map((l) => chargesAfterKill(l, 1, 1))).toEqual([0, 1, 1]); // diagonal
    expect([0, 1, 2].map((l) => chargesAfterKill(l, 2, 0))).toEqual([0, 0, 1]); // a 2 casas
    expect([0, 1, 2].map((l) => chargesAfterKill(l, 3, 0))).toEqual([0, 0, 0]); // fora
  });

  it('"copiar" (Espelho) procura a vizinha dentro da vizinhança ampliada', () => {
    const copied = (level: number, dx: number, dy: number): string => {
      const state = makeState();
      setLevels(state, { arcane: level });
      const mimic = idle(addTower(state, 'mimicOnActivate', 5, 5));
      const src = idle(addTower(state, 'arrow', 5 + dx, 5 + dy));
      src.lastEffect = { effect: { kind: 'explosion', radius: 0.5, damagePercent: 50 }, seq: 1 };
      const fact = {
        type: 'towerActivated',
        tick: 0,
        towerId: mimic.id,
        sourceTowerId: src.id,
        depth: 1,
      } as const;
      const events = run(triggerSim(state, triggerData(), [factsAt(1, [fact])]), 1);
      return ofType(events, 'triggerFired')[0]!.effect;
    };
    expect([0, 1, 2].map((l) => copied(l, 1, 1))).toEqual(['copyLast', 'explosion', 'explosion']);
    expect([0, 1, 2].map((l) => copied(l, 2, 0))).toEqual(['copyLast', 'copyLast', 'explosion']);
  });
});

// ---------------------------------------------------------------------------
// Sombria
// ---------------------------------------------------------------------------

describe('bônus da Sombria', () => {
  const shadowListener = classed(['arcane', 'shadow']);
  const shadow = classed(['artillery', 'shadow']);
  const notShadow = classed(['mechanical', 'arcane']);
  const levelState = (level: number) => {
    const state = makeState();
    setLevels(state, { shadow: level });
    return state;
  };
  const weight = (level: number, killer: TowerType | null, base = 1, listener = shadowListener) =>
    killWeight(classData, levelState(level), listener, killer, base);

  it('nível 2: só mortes de torres Sombria valem 2; nível 4: qualquer autor, inclusive o núcleo', () => {
    expect([0, 1, 2].map((l) => weight(l, shadow))).toEqual([1, 2, 2]);
    expect([0, 1, 2].map((l) => weight(l, notShadow))).toEqual([1, 1, 2]);
    expect([0, 1, 2].map((l) => weight(l, null))).toEqual([1, 1, 2]);
  });

  it('o bônus é só das torres Sombria: quem escuta e não é Sombria não muda', () => {
    expect([0, 1, 2].map((l) => weight(l, shadow, 1, notShadow))).toEqual([1, 1, 1]);
  });

  it('peso acumulado multiplica com o do abate e respeita o teto de 4 dos dados', () => {
    expect(weight(1, shadow, 2)).toBe(4); // 2 × 2
    expect(weight(2, notShadow, 2)).toBe(4);
    const cap3 = loadClassData({ ...classesJson, maxKillWeight: 3 });
    expect(killWeight(cap3, levelState(2), shadowListener, shadow, 2)).toBe(3);
    expect(killWeight(cap3, levelState(2), shadowListener, shadow, 1)).toBe(2);
    // Sem bônus aplicado, o peso original passa como está.
    expect(killWeight(cap3, levelState(0), shadowListener, shadow, 2)).toBe(2);
  });

  it('cargas do Obelisco e "a cada N abates" andam pelo peso novo', () => {
    const data = withTypes({
      shObelisk: armedType(
        'neighborKills',
        'chargeLightning',
        { charges: 3, targets: 3, jumpRadius: 1, damagePercent: 100 },
        { classes: ['arcane', 'shadow'] },
      ),
      shCollector: armedType(
        'everyNKillsInRange',
        'explosion',
        { kills: 100, radius: 0.5, damagePercent: 100 },
        { classes: ['arcane', 'shadow'] },
      ),
      bomb2: shadow,
    });
    const cases: [string, number, string, number, number][] = [
      // [descrição, nível, autor, peso do abate, cargas/contador esperado]
      ['nível 0', 0, 'bomb2', 1, 1],
      ['nível 2, autor Sombria', 1, 'bomb2', 1, 2],
      ['nível 2, autor de outra classe', 1, 'arrow', 1, 1],
      ['nível 4, autor de outra classe', 2, 'arrow', 1, 2],
      ['nível 2, abate duplo (2×2 = 4, no teto)', 1, 'bomb2', 2, 4],
    ];
    for (const [name, level, killerType, w, expected] of cases) {
      const state = makeState();
      setLevels(state, { shadow: level });
      const obelisk = idle(addTower(state, 'shObelisk', 5, 5));
      const collector = idle(addTower(state, 'shCollector', 0, 0));
      const killer = idle(addTower(state, killerType, 5, 6));
      const sim = triggerSim(state, data, [factsAt(1, [killFact(0, 0.5, killer.id, w)])]);
      run(sim, 1);
      // O Obelisco solta o raio se as cargas chegam a 3 e houver alvo; sem alvo elas esperam (teto 3).
      expect(Math.min(obelisk.charges, 3), name).toBe(Math.min(expected, 3));
      expect(collector.triggerCounter, name).toBe(expected);
    }
  });

  it('não duplica eventos: o Ceifador solta uma explosão por morte, com bônus ou não', () => {
    for (const level of [0, 2]) {
      const state = levelState(level);
      idle(addTower(state, 'reaper', 0, 0));
      const events = run(
        triggerSim(state, triggerData(), [factsAt(1, [killFact(1, 0, 9), killFact(1, 0, null)])]),
        1,
      );
      expect(ofType(events, 'triggerFired')).toHaveLength(2);
    }
  });

  it('peso 0 (soltar carga guardada) continua 0', () => {
    expect(weight(2, shadow, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinismo e save, com as torres reais
// ---------------------------------------------------------------------------

describe('bônus na partida real', () => {
  const map = loadMap(mapData);
  const { chainScenario } = debugConfig;

  function chain(
    layout: DebugLayout,
    seed: string,
    towers?: TowerData,
    types?: string[],
  ): Simulation {
    const sim = Simulation.create(seed, createGameSystems(map, towers ? { towers } : {}));
    sim.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    sim.enqueue({
      type: 'debugSpawnTowers',
      count: debugConfig.defaults.towerCount,
      towerTypes: types ?? chainScenario.towerTypes,
      layout: chainScenario.towerLayout as DebugLayout,
    });
    sim.enqueue({ type: 'debugSetStress', stress: { count: 300, layout } });
    return sim;
  }

  const steps = (sim: Simulation, ticks: number): SimEvent[] => run(sim, ticks);

  it('as 4 torres provisórias chegam a 2 em cada classe: nível 2 de todas', () => {
    const sim = chain('spread', 'classes');
    steps(sim, 3);
    expect(countsOf(sim.state)).toEqual({ artillery: 2, mechanical: 2, arcane: 2, shadow: 2 });
    expect(levelsOf(sim.state)).toEqual({ artillery: 1, mechanical: 1, arcane: 1, shadow: 1 });
    expect(sim.state.classes.arcane!.members).toEqual(['obelisk', 'relay']);
  });

  it('mesma semente, mesmo resultado; o bônus muda o resultado da partida', () => {
    const a = chain('clustered', 'det');
    const b = chain('clustered', 'det');
    steps(a, 300);
    steps(b, 300);
    expect(b.serialize()).toBe(a.serialize());

    // Mesmo cenário com as classes sem nível nos dados: o resultado é outro.
    const disabled = Simulation.create(
      'det',
      createGameSystems(map, {
        classes: loadClassData({
          ...classesJson,
          classes: Object.fromEntries(
            Object.entries(classesJson.classes).map(([id, c]) => [id, { ...c, levels: [] }]),
          ),
        }),
      }),
    );
    disabled.enqueue({ type: 'debugSetNexusInvulnerable', value: true });
    disabled.enqueue({
      type: 'debugSpawnTowers',
      count: debugConfig.defaults.towerCount,
      towerTypes: chainScenario.towerTypes,
      layout: chainScenario.towerLayout as DebugLayout,
    });
    disabled.enqueue({ type: 'debugSetStress', stress: { count: 300, layout: 'clustered' } });
    steps(disabled, 300);
    expect(disabled.serialize()).not.toBe(a.serialize());
  });

  it('salvar no meio da onda com o bônus ativo e retomar dá o mesmo resultado', () => {
    const a = chain('spread', 'save');
    steps(a, 120);
    expect(levelsOf(a.state)).toEqual({ artillery: 1, mechanical: 1, arcane: 1, shadow: 1 });
    const json = a.serialize();
    const resumed = new Simulation(deserializeRunState(json), createGameSystems(map));
    steps(a, 200);
    steps(resumed, 200);
    expect(resumed.serialize()).toBe(a.serialize());
  });

  it('nível 4 em todas as classes (dados de teste): determinístico e retoma do save', () => {
    const raw = JSON.parse(JSON.stringify(towersJson)) as {
      types: Record<string, unknown>;
    };
    const plain = {
      damage: 5,
      shotsPerSecond: 1,
      range: 3,
      projectileSpeed: 8,
      shot: { kind: 'single' },
      targetMode: 'first',
      trigger: null,
    };
    raw.types.dummyA = { name: 'Teste A', classes: ['artillery', 'mechanical'], ...plain };
    raw.types.dummyB = { name: 'Teste B', classes: ['arcane', 'shadow'], ...plain };
    raw.types.dummyC = { name: 'Teste C', classes: ['mechanical', 'artillery'], ...plain };
    raw.types.dummyD = { name: 'Teste D', classes: ['shadow', 'arcane'], ...plain };
    const towers = loadTowerData(raw);
    const types = [...chainScenario.towerTypes, 'dummyA', 'dummyB', 'dummyC', 'dummyD'];
    const build = () => chain('clustered', 'lv4', towers, types);

    const a = build();
    steps(a, 120);
    expect(levelsOf(a.state)).toEqual({ artillery: 2, mechanical: 2, arcane: 2, shadow: 2 });

    const json = a.serialize();
    const resumed = new Simulation(deserializeRunState(json), createGameSystems(map, { towers }));
    steps(a, 200);
    steps(resumed, 200);
    expect(resumed.serialize()).toBe(a.serialize());

    const b = build();
    steps(b, 320);
    expect(b.serialize()).toBe(a.serialize());
  });
});
