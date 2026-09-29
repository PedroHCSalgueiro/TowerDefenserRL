import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/engine/simulation';
import { createProjectileSystem } from '../src/sim/projectiles/systems';
import { SpatialIndex } from '../src/sim/spatial/spatialIndex';
import type { RunState } from '../src/sim/state';
import type { Tower } from '../src/sim/towers/placement';
import { createTowerSystem } from '../src/sim/towers/systems';
import { createTargetScores } from '../src/sim/towers/targeting';
import { towerData } from '../src/sim/towers/towerData';
import { createTriggerSystem } from '../src/sim/triggers/engine';
import { TPS, makeState, place, testEnemies } from './support/enemySim';
import { addTower, run, smallRoutes } from './support/towerSim';
import {
  armedType,
  factsAt,
  firedSummary,
  killFact,
  ofType,
  triggerData,
  triggerSim,
  triggerTypes,
} from './support/triggerSim';

/** Torre que não dispara por conta própria (só por ativação ou gatilho). */
function idle(tower: Tower): Tower {
  tower.cooldownTicks = 1e6;
  return tower;
}

function shotFact(towerId: number, shot: 'normal' | 'activated' | 'extra') {
  return { type: 'towerFired', tick: 0, towerId, targetId: 1, shot } as const;
}

describe('"quando" (fatos do tick → fila)', () => {
  it('a cada N tiros: conta tiros normais e de ativação, nunca os extras', () => {
    const state = makeState();
    const t = idle(addTower(state, 'counter', 0, 0));
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [shotFact(t.id, 'normal'), shotFact(t.id, 'extra'), shotFact(t.id, 'activated')]),
      factsAt(2, [shotFact(t.id, 'extra'), shotFact(t.id, 'normal'), shotFact(t.id, 'normal')]),
    ]);
    expect(ofType(run(sim, 1), 'triggerFired')).toEqual([]);
    expect(t.triggerCounter).toBe(2);

    const fired = ofType(run(sim, 1), 'triggerFired');
    expect(fired).toEqual([
      {
        type: 'triggerFired',
        tick: 2,
        towerId: t.id,
        sourceTowerId: t.id,
        when: 'everyNShots',
        effect: 'multiShot',
        depth: 1,
      },
    ]);
    expect(t.triggerCounter).toBe(1); // o 4º tiro já conta para o próximo ciclo
  });

  it('ao disparar: tiro normal e de ativação disparam; tiro extra não', () => {
    const state = makeState();
    const t = idle(addTower(state, 'relay', 0, 0));
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [shotFact(t.id, 'normal'), shotFact(t.id, 'extra'), shotFact(t.id, 'activated')]),
    ]);
    expect(ofType(run(sim, 1), 'triggerFired')).toHaveLength(2);
  });

  it('ao ser ativada: dispara com a origem da ativação', () => {
    const state = makeState();
    const t = idle(addTower(state, 'bang', 0, 0));
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [{ type: 'towerActivated', tick: 0, towerId: t.id, sourceTowerId: 77, depth: 1 }]),
    ]);
    expect(ofType(run(sim, 1), 'triggerFired')).toEqual([
      expect.objectContaining({ towerId: t.id, sourceTowerId: 77, when: 'onActivated', depth: 1 }),
    ]);
  });

  it('inimigo morre no alcance: qualquer autor (inclusive o núcleo), uma vez por morte', () => {
    const state = makeState();
    const t = idle(addTower(state, 'reaper', 0, 0)); // alcance 1,5
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [
        killFact(1, 1, 55, 2), // √2 ≈ 1,41: no alcance; abate duplo dispara uma vez só
        killFact(1.5, 0.1, 55), // fora do alcance
        killFact(0.5, 0, null), // morto pelo núcleo
      ]),
    ]);
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').map((e) => e.sourceTowerId)).toEqual([55, null]);
    // A explosão sai no ponto de cada morte.
    expect(ofType(events, 'areaExploded').map((e) => [e.x, e.y])).toEqual([
      [1, 1],
      [0.5, 0],
    ]);
    expect(t.charges).toBe(0);
  });

  it('vizinha abate: só as 4 casas de lado; abate duplo vale 2 cargas', () => {
    const state = makeState();
    const obelisk = idle(addTower(state, 'obelisk', 1, 0));
    const side = idle(addTower(state, 'arrow', 0, 0));
    const diagonal = idle(addTower(state, 'arrow', 2, 1));
    const far = idle(addTower(state, 'arrow', 3, 0));
    const facts = [
      killFact(0, 0, side.id),
      killFact(0, 0, diagonal.id),
      killFact(0, 0, far.id),
      killFact(0, 0, obelisk.id), // o próprio abate não é de vizinha
      killFact(0, 0, null),
      killFact(0, 0, side.id, 2),
    ];
    const sim = triggerSim(state, triggerData(), [factsAt(1, facts)]);
    const fired = ofType(run(sim, 1), 'triggerFired');
    expect(fired.map((e) => e.sourceTowerId)).toEqual([side.id, side.id]);
    expect(obelisk.charges).toBe(3); // sem alvo no alcance, as cargas esperam

    // Com vizinhança de 8 casas, a diagonal também conta.
    const state8 = makeState();
    const o8 = idle(addTower(state8, 'obelisk', 1, 0));
    const d8 = idle(addTower(state8, 'arrow', 2, 1));
    const sim8 = triggerSim(state8, triggerData({ neighborhood: 8 }), [
      factsAt(1, [killFact(0, 0, d8.id)]),
    ]);
    run(sim8, 1);
    expect(o8.charges).toBe(1);
  });

  it('a cada N abates no alcance: qualquer autor, abate duplo conta 2', () => {
    const state = makeState();
    const t = idle(addTower(state, 'collector', 0, 0)); // a cada 2 abates
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [
        killFact(1, 0, 9), // 1
        killFact(3, 0, 9), // fora do alcance
        killFact(0, 1, null, 2), // 3 → dispara, sobra 1
      ]),
      factsAt(2, [killFact(0.5, 0.5, 9)]), // 2 → dispara
    ]);
    expect(ofType(run(sim, 1), 'triggerFired')).toHaveLength(1);
    expect(t.triggerCounter).toBe(1);
    expect(ofType(run(sim, 1), 'triggerFired')).toHaveLength(1);
    expect(t.triggerCounter).toBe(0);
  });

  it('um fato que serve para várias torres: entram na fila em ordem de id', () => {
    const state = makeState();
    const a = idle(addTower(state, 'reaper', 0, 0));
    const b = idle(addTower(state, 'reaper', 1, 0));
    const c = idle(addTower(state, 'reaper', 0, 1));
    state.towers.reverse(); // ordem no array ≠ ordem de id
    const sim = triggerSim(state, triggerData(), [factsAt(1, [killFact(0.5, 0.5, null)])]);
    expect(ofType(run(sim, 1), 'triggerFired').map((e) => e.towerId)).toEqual([a.id, b.id, c.id]);
  });
});

describe('"o quê" (efeitos)', () => {
  it('disparo múltiplo: tiros extras no alvo normal, sem gastar a recarga e sem contar como tiro', () => {
    const state = makeState();
    const t = addTower(state, 'counter', 0, 0); // a cada 3 tiros, +2
    const brick = place(state, 'brick', 1, 0, 1e9);
    const events = run(triggerSim(state), 24);
    const shots = ofType(events, 'towerFired');
    expect(shots.filter((e) => e.shot === 'normal').map((e) => e.tick)).toEqual([
      1, 5, 9, 13, 17, 21,
    ]);
    expect(shots.filter((e) => e.shot === 'extra').map((e) => e.tick)).toEqual([9, 9, 21, 21]);
    expect(shots.every((e) => e.targetId === brick.id)).toBe(true);
    expect(ofType(events, 'triggerFired').map((e) => e.tick)).toEqual([9, 21]);
    expect(t.cooldownTicks).toBe(1); // recarga do tiro normal do tick 21, nada a mais
  });

  it('explosão: no ponto da morte, % do dano base, em ordem de id; a morte causada continua a cadeia', () => {
    const state = makeState();
    const reaper = idle(addTower(state, 'reaper', 0, 0)); // 50% de 6 = 3, raio 0,5
    const first = place(state, 'walker', 0.5, 1, 3);
    const near = place(state, 'walker', 0.8, 1, 10); // 0,3 do ponto
    const outside = place(state, 'walker', 1.2, 1, 10); // 0,7 do ponto
    const sim = triggerSim(state, triggerData(), [factsAt(1, [killFact(0.5, 1, null)])]);
    const events = run(sim, 1);
    expect(first.active).toBe(false);
    expect(ofType(events, 'enemyKilled').filter((e) => e.enemyId !== 9999)).toEqual([
      expect.objectContaining({ enemyId: first.id, towerId: reaper.id, x: 0.5, y: 1, weight: 1 }),
    ]);
    // 1ª explosão (fato sintético) e 2ª (morte de `first`, profundidade 2).
    expect(firedSummary(events, { [reaper.id]: 'R' })).toEqual(['R:explosion@1', 'R:explosion@2']);
    expect(near.hp).toBe(4);
    expect(outside.hp).toBe(10);
  });

  it('explosão sem ponto de morte: no alvo normal da torre', () => {
    const state = makeState();
    const t = idle(addTower(state, 'bang', 0, 0));
    const target = place(state, 'brick', 1, 0.5, 100);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [{ type: 'towerActivated', tick: 0, towerId: t.id, sourceTowerId: 1, depth: 1 }]),
    ]);
    const events = run(sim, 1);
    expect(ofType(events, 'areaExploded')).toEqual([
      { type: 'areaExploded', tick: 1, towerId: t.id, x: 1, y: 0.5, radius: 0.5 },
    ]);
    expect(target.hp).toBe(97);
  });

  it('ativar vizinhas: tiro extra na hora, sem gastar a recarga, em ordem de id, 1 vez por segundo', () => {
    const state = makeState();
    const right = idle(addTower(state, 'arrow', 2, 0));
    const relay = addTower(state, 'relay', 1, 0);
    const left = idle(addTower(state, 'arrow', 0, 0));
    const diagonal = idle(addTower(state, 'arrow', 2, 1));
    place(state, 'brick', 1, 0.5, 1e9);
    const events = run(triggerSim(state), 9);

    const first = events.filter((e) => e.tick === 1 && e.type !== 'enemyKilled');
    expect(first).toEqual([
      {
        type: 'towerFired',
        tick: 1,
        towerId: relay.id,
        targetId: expect.any(Number),
        shot: 'normal',
      },
      expect.objectContaining({
        type: 'triggerFired',
        towerId: relay.id,
        effect: 'activateNeighbors',
      }),
      { type: 'towerActivated', tick: 1, towerId: right.id, sourceTowerId: relay.id, depth: 1 },
      expect.objectContaining({ type: 'towerFired', towerId: right.id, shot: 'activated' }),
      { type: 'towerActivated', tick: 1, towerId: left.id, sourceTowerId: relay.id, depth: 1 },
      expect.objectContaining({ type: 'towerFired', towerId: left.id, shot: 'activated' }),
    ]);
    // A recarga das ativadas não mudou (só o decremento normal do tick).
    expect(right.cooldownTicks).toBe(1e6 - 9);
    // O Relé dispara nos ticks 1, 5 e 9; a trava de 1 s (8 ticks) segura o tick 5.
    expect(ofType(events, 'towerActivated').map((e) => [e.tick, e.towerId])).toEqual([
      [1, right.id],
      [1, left.id],
      [9, right.id],
      [9, left.id],
    ]);
    expect(ofType(events, 'towerActivated').some((e) => e.towerId === diagonal.id)).toBe(false);
  });

  it('ativar vizinhas: até maxTargets, pulando as travadas; ativada sem alvo gasta a trava e não atira', () => {
    const types = {
      ...triggerTypes,
      relay1: armedType('onFire', 'activateNeighbors', { maxTargets: 1 }),
    };
    const state = makeState();
    const locked = idle(addTower(state, 'arrow', 0, 0));
    const relay = addTower(state, 'relay1', 1, 0);
    const blind = idle(addTower(state, 'arrow', 1, -1)); // alvo a 2,4 casas: fora do alcance
    const other = idle(addTower(state, 'arrow', 2, 0));
    locked.activationReadyTick = 100;
    place(state, 'brick', 1, 1.4, 1e9); // no alcance do Relé (1,4)
    const data = { ...triggerData(), types };
    let events = run(triggerSim(state, data), 1);
    // Só 1 ativação: a travada é pulada, e a próxima em ordem de id é `blind`.
    expect(ofType(events, 'towerActivated').map((e) => e.towerId)).toEqual([blind.id]);
    expect(ofType(events, 'towerFired').some((e) => e.towerId === blind.id)).toBe(false);
    expect(blind.activationReadyTick).toBe(1 + TPS);
    expect(other.activationReadyTick).toBe(0);
    void relay;

    // Sem vizinhas: o gatilho dispara e não faz nada.
    const lonely = makeState();
    addTower(lonely, 'relay', 1, 0);
    place(lonely, 'brick', 1, 0.5, 1e9);
    events = run(triggerSim(lonely), 1);
    expect(ofType(events, 'triggerFired')).toHaveLength(1);
    expect(ofType(events, 'towerActivated')).toEqual([]);
  });

  it('raio em cadeia: 3 cargas, salta do anterior para o mais próximo, sem repetir', () => {
    const state = makeState();
    const obelisk = idle(addTower(state, 'obelisk', 2, 0)); // 3 alvos, salto 1, dano 6
    const killer = idle(addTower(state, 'arrow', 1, 0));
    const first = place(state, 'walker', 2, 1, 20); // alvo normal (menor id no alcance)
    const second = place(state, 'walker', 1.5, 1, 20); // 0,5 do primeiro
    const third = place(state, 'walker', 0.8, 1, 20); // 0,7 do segundo; 1,2 do primeiro
    const skipped = place(state, 'walker', 2.6, 1, 20); // 0,6 do primeiro: perde para o segundo
    const kill = killFact(0, 0, killer.id);
    const sim = triggerSim(state, triggerData(), [factsAt(1, [kill, kill, kill])]);
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').map((e) => e.effect)).toEqual([
      'chargeLightning',
      'chargeLightning',
      'chargeLightning',
    ]);
    expect([first.hp, second.hp, third.hp, skipped.hp]).toEqual([14, 14, 14, 20]);
    expect(obelisk.charges).toBe(0);
    expect(obelisk.lastEffect?.effect.kind).toBe('chargeLightning');
  });

  it('raio em cadeia: abate duplo = 2 cargas, e o excedente fica', () => {
    const state = makeState();
    const obelisk = idle(addTower(state, 'obelisk', 2, 0));
    const killer = idle(addTower(state, 'arrow', 1, 0));
    const target = place(state, 'brick', 2, 1, 100);
    const sim = triggerSim(state, triggerData(), [
      factsAt(1, [killFact(0, 0, killer.id, 2), killFact(0, 0, killer.id, 2)]),
    ]);
    run(sim, 1);
    expect(target.hp).toBe(94);
    expect(obelisk.charges).toBe(1);
  });

  it('raio em cadeia: cheio e sem alvo, sai no próximo tiro da própria torre que tiver alvo', () => {
    const state = makeState();
    const obelisk = addTower(state, 'obelisk', 2, 0);
    const killer = idle(addTower(state, 'arrow', 1, 0));
    const kill = killFact(0, 0, killer.id);
    const sim = triggerSim(state, triggerData(), [factsAt(1, [kill, kill, kill])]);
    let events = run(sim, 2);
    expect(obelisk.charges).toBe(3); // ninguém no alcance
    expect(ofType(events, 'triggerFired')).toHaveLength(3);

    const target = place(state, 'brick', 2, 1, 100);
    events = run(sim, 1);
    expect(ofType(events, 'towerFired')).toEqual([
      expect.objectContaining({ towerId: obelisk.id, shot: 'normal' }),
    ]);
    expect(ofType(events, 'triggerFired')).toEqual([
      expect.objectContaining({ towerId: obelisk.id, sourceTowerId: obelisk.id, depth: 1 }),
    ]);
    expect(target.hp).toBe(94); // o raio é instantâneo; o projétil ainda está no ar
    expect(obelisk.charges).toBe(0);
  });

  it('raio em cadeia: sem alvo, as cargas param no valor da descarga e não acumulam acima', () => {
    const types = {
      ...triggerTypes,
      // Como uma estrela que descarrega com 2 cargas (o teto vem dos dados da estrela).
      obelisk2: armedType('neighborKills', 'chargeLightning', {
        charges: 2,
        targets: 1,
        jumpRadius: 1,
        damagePercent: 100,
      }),
    };
    const state = makeState();
    const obelisk = addTower(state, 'obelisk', 2, 0); // descarga com 3
    const other = idle(addTower(state, 'obelisk2', 3, 1));
    const killer = idle(addTower(state, 'arrow', 3, 0)); // vizinha das duas
    const kill = killFact(0, 0, killer.id);
    const double = killFact(0, 0, killer.id, 2);
    const sim = triggerSim(state, { ...triggerData(), types }, [
      factsAt(1, [kill, kill, double, kill, double]), // 7 cargas sem teto
    ]);
    run(sim, 2);
    expect([obelisk.charges, other.charges]).toEqual([3, 2]);

    // Com alvo, sai um raio só, e não sobra nada do que chegou enquanto esperava.
    const target = place(state, 'brick', 2, 1, 100);
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').filter((e) => e.towerId === obelisk.id)).toHaveLength(1);
    expect(target.hp).toBe(94);
    expect(obelisk.charges).toBe(0);
  });

  it('tiro perfurante: todos na linha torre → alvo, até o alcance, e ninguém fora dela', () => {
    const state = makeState();
    addTower(state, 'piercer', 0, 0); // alcance 2, meia-largura 0,25
    const target = place(state, 'brick', 1, 0, 100);
    const onLine = place(state, 'brick', 1.8, 0.2, 100);
    const beyond = place(state, 'brick', 2.1, 0, 100);
    const behind = place(state, 'brick', -0.5, 0, 100);
    const offLine = place(state, 'brick', 1, 0.4, 100);
    run(triggerSim(state), 1);
    expect([target.hp, onLine.hp]).toEqual([94, 94]);
    expect([beyond.hp, behind.hp, offLine.hp]).toEqual([100, 100, 100]);
  });

  it('execução: abaixo de 15% da vida máxima morre na hora, sem armadura, valendo 2 abates', () => {
    const types = {
      ...triggerTypes,
      bigObelisk: armedType('neighborKills', 'chargeLightning', {
        charges: 10,
        targets: 1,
        jumpRadius: 1,
        damagePercent: 100,
      }),
    };
    const state = makeState();
    const executioner = addTower(state, 'executioner', 0, 0);
    const obelisk = idle(addTower(state, 'bigObelisk', 1, 0));
    const low = place(state, 'walker', 0.5, 0, 100);
    const exact = place(state, 'walker', 0.6, 0, 100);
    const armored = place(state, 'tank', 0.7, 0, 100);
    const far = place(state, 'walker', 2, 0, 100);
    low.hp = 14;
    exact.hp = 15; // 15% exato: não é "abaixo"
    armored.hp = 10;
    far.hp = 5;
    const events = run(triggerSim(state, { ...triggerData(), types }), 1);
    expect(ofType(events, 'enemyKilled')).toEqual([
      expect.objectContaining({ enemyId: low.id, towerId: executioner.id, weight: 2 }),
      expect.objectContaining({ enemyId: armored.id, towerId: executioner.id, weight: 2 }),
    ]);
    expect([exact.active, far.active]).toEqual([true, true]);
    expect(obelisk.charges).toBe(4); // 2 abates duplos da vizinha
  });

  it('copiar: repete o último "o quê" das vizinhas, com os números dela e o corpo de quem copia', () => {
    const state = makeState();
    state.triggers.nextSeq = 10;
    const mimic = idle(addTower(state, 'mimic', 1, 0)); // dano base 10
    const older = idle(addTower(state, 'arrow', 0, 0));
    const newer = idle(addTower(state, 'arrow', 2, 0));
    older.lastEffect = { effect: { kind: 'pierceLine', halfWidth: 1, damagePercent: 100 }, seq: 3 };
    newer.lastEffect = { effect: { kind: 'explosion', radius: 0.5, damagePercent: 50 }, seq: 5 };
    const victim = place(state, 'brick', 1, 1, 100);
    const sim = triggerSim(state, triggerData(), [factsAt(1, [killFact(1, 1, older.id)])]);
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired')).toEqual([
      expect.objectContaining({ towerId: mimic.id, when: 'neighborKills', effect: 'explosion' }),
    ]);
    expect(ofType(events, 'areaExploded')).toEqual([
      expect.objectContaining({ towerId: mimic.id, x: 1, y: 1, radius: 0.5 }),
    ]);
    expect(victim.hp).toBe(95); // 50% do dano base de quem copia (10)
    expect(mimic.lastEffect).toEqual({ effect: newer.lastEffect.effect, seq: 10 });
  });

  it('copiar: sem nada para copiar não faz nada; o raio copiado sai na hora, sem cargas', () => {
    const state = makeState();
    const mimic = idle(addTower(state, 'mimicOnActivate', 1, 0));
    const neighbor = idle(addTower(state, 'arrow', 0, 0));
    const activate = {
      type: 'towerActivated',
      tick: 0,
      towerId: mimic.id,
      sourceTowerId: 1,
      depth: 1,
    } as const;
    const target = place(state, 'brick', 1, 1, 100);
    const sim = triggerSim(state, triggerData(), [factsAt(1, [activate]), factsAt(2, [activate])]);
    let events = run(sim, 1);
    expect(ofType(events, 'triggerFired')).toEqual([
      expect.objectContaining({ towerId: mimic.id, effect: 'copyLast' }),
    ]);
    expect(mimic.lastEffect).toBeNull();

    neighbor.lastEffect = {
      effect: {
        kind: 'chargeLightning',
        charges: 3,
        targets: 1,
        jumpRadius: 1,
        damagePercent: 100,
      },
      seq: 1,
    };
    events = run(sim, 1);
    expect(ofType(events, 'triggerFired')).toEqual([
      expect.objectContaining({ towerId: mimic.id, effect: 'chargeLightning' }),
    ]);
    expect(target.hp).toBe(90);
    expect(mimic.charges).toBe(0);
  });
});

describe('cadeias', () => {
  it('cadeia de 3 torres: Relé ativa B, B ativa A e C, C explode', () => {
    const state = makeState();
    const a = addTower(state, 'relay', 0, 0);
    const b = idle(addTower(state, 'echo', 1, 0));
    const c = idle(addTower(state, 'bang', 2, 0));
    const brick = place(state, 'brick', 1, 1, 1e9);
    const events = run(triggerSim(state), 1);
    const names = { [a.id]: 'A', [b.id]: 'B', [c.id]: 'C' };
    expect(firedSummary(events, names)).toEqual([
      'A:activateNeighbors@1',
      'B:activateNeighbors@2',
      'A:activateNeighbors@3', // A foi reativada por B; B está travada, nada acontece
      'C:explosion@3',
    ]);
    expect(
      ofType(events, 'towerActivated').map((e) => [
        names[e.sourceTowerId],
        names[e.towerId],
        e.depth,
      ]),
    ).toEqual([
      ['A', 'B', 1],
      ['B', 'A', 2],
      ['B', 'C', 2],
    ]);
    expect(ofType(events, 'areaExploded')).toEqual([
      expect.objectContaining({ towerId: c.id, x: 1, y: 1 }),
    ]);
    expect(brick.hp).toBe(1e9 - 3);
  });

  it('torres reais: o Relé reativa o Morteiro, que completa 5 tiros e dispara três vezes', () => {
    const state = makeState();
    const mortar = idle(addTower(state, 'mortar', 0, 0));
    const relay = addTower(state, 'relay', 1, 0);
    mortar.triggerCounter = 4;
    place(state, 'brick', 1, 1, 1e9);
    const index = new SpatialIndex(1);
    const scores = createTargetScores(smallRoutes, testEnemies);
    const deps = { index, enemies: testEnemies, towers: towerData, scores, ticksPerSecond: TPS };
    const sim = new Simulation(state, [
      createProjectileSystem(testEnemies, index, towerData.projectileRetargetRadius, TPS),
      createTowerSystem(index, towerData, scores, TPS),
      createTriggerSystem(deps),
    ]);
    const events = run(sim, 1);
    expect(firedSummary(events, { [relay.id]: 'Relé', [mortar.id]: 'Morteiro' })).toEqual([
      'Relé:activateNeighbors@1',
      'Morteiro:multiShot@2',
    ]);
    expect(
      ofType(events, 'towerFired')
        .filter((e) => e.towerId === mortar.id)
        .map((e) => e.shot),
    ).toEqual(['activated', 'extra', 'extra']);
    expect(mortar.triggerCounter).toBe(0);
  });
});

describe('seguranças', () => {
  it('loop contido: dois Relés vizinhos se ativam no máximo 1 vez por segundo cada', () => {
    const state = makeState();
    const a = addTower(state, 'relay', 0, 0);
    const b = addTower(state, 'relay', 1, 0);
    place(state, 'brick', 0.5, 0.5, 1e12);
    const events = run(triggerSim(state), 200);
    for (const tower of [a, b]) {
      const ticks = ofType(events, 'towerActivated')
        .filter((e) => e.towerId === tower.id)
        .map((e) => e.tick);
      expect(ticks.length).toBeGreaterThan(20);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]! - ticks[i - 1]!).toBeGreaterThanOrEqual(TPS);
      }
    }
    expect(state.triggers.queue).toEqual([]);
  });

  it('loop contido mesmo com trava de 1 tick: "ao ser ativada → ativa as vizinhas" num bloco 2×2', () => {
    // Sem trava, A ativa B, que ativa A, que ativa B... para sempre, dentro do mesmo tick.
    const state = makeState();
    const block = [
      addTower(state, 'echo', 0, 0),
      addTower(state, 'echo', 1, 0),
      addTower(state, 'echo', 0, 1),
      addTower(state, 'echo', 1, 1),
    ].map(idle);
    const start = {
      type: 'towerActivated',
      tick: 0,
      towerId: block[0]!.id,
      sourceTowerId: 999,
      depth: 1,
    } as const;
    const data = triggerData({ activationCooldownSeconds: 1 / TPS });
    const sim = triggerSim(state, data, [factsAt(1, [start])]);
    const events = run(sim, 20);
    const fired = ofType(events, 'triggerFired');
    // A cadeia termina no próprio tick 1: cada torre é ativada uma vez e trava.
    expect(fired.every((e) => e.tick === 1)).toBe(true);
    expect(fired.length).toBeLessThanOrEqual(block.length + 1);
    const activated = ofType(events, 'towerActivated')
      .filter((e) => e.sourceTowerId !== 999) // o fato sintético que começa a cadeia
      .map((e) => e.towerId);
    expect(new Set(activated).size).toBe(activated.length);
    expect(state.triggers.queue).toEqual([]);
  });

  /** 10 torres "ao ser ativada → ativa as vizinhas" em linha; a primeira é ativada no tick 1. */
  function line(data = triggerData()): { sim: Simulation; state: RunState; towers: Tower[] } {
    const state = makeState();
    const towers = Array.from({ length: 10 }, (_, x) => idle(addTower(state, 'echo', x, 0)));
    towers[0]!.activationReadyTick = 1000; // a primeira não é reativada pela segunda
    const start = {
      type: 'towerActivated',
      tick: 0,
      towerId: towers[0]!.id,
      sourceTowerId: 1,
      depth: 1,
    } as const;
    return { sim: triggerSim(state, data, [factsAt(1, [start])]), state, towers };
  }

  function firedByTick(sim: Simulation, ticks: number): Map<number, number[]> {
    const byTick = new Map<number, number[]>();
    for (const e of ofType(run(sim, ticks), 'triggerFired')) {
      byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e.depth]);
    }
    return byTick;
  }

  it('profundidade máxima por tick: o resto continua no tick seguinte, sem perder nada', () => {
    const free = line(triggerData({ maxChainDepthPerTick: 100 }));
    expect(firedByTick(free.sim, 5)).toEqual(new Map([[1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]]));

    const limited = line(triggerData({ maxChainDepthPerTick: 3 }));
    const stats: number[] = [];
    const byTick = new Map<number, number[]>();
    for (let i = 0; i < 5; i++) {
      for (const [tick, depths] of firedByTick(limited.sim, 1)) byTick.set(tick, depths);
      stats.push(limited.state.triggers.lastTick.deferred);
    }
    expect(byTick).toEqual(
      new Map([
        [1, [1, 2, 3]],
        [2, [4, 5, 6]],
        [3, [7, 8, 9]],
        [4, [10]],
      ]),
    );
    expect(stats).toEqual([1, 1, 1, 0, 0]);
    expect(limited.state.triggers.droppedTotal).toBe(0);
  });

  it('orçamento por tick: acima de maxActivationsPerTick, o resto vai para o tick seguinte', () => {
    const limited = line(triggerData({ maxActivationsPerTick: 4 }));
    expect(firedByTick(limited.sim, 5)).toEqual(
      new Map([
        [1, [1, 2, 3, 4]],
        [2, [5, 6, 7, 8]],
        [3, [9, 10]],
      ]),
    );
  });

  it('teto da fila: o excesso é descartado (os mais novos) e contado', () => {
    const state = makeState();
    const reapers = [
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [2, -1],
    ].map(([x, y]) => idle(addTower(state, 'reaper', x!, y!)));
    const sim = triggerSim(state, triggerData({ maxQueueSize: 2 }), [
      factsAt(1, [killFact(2, 0, null)]),
    ]);
    const events = run(sim, 1);
    expect(ofType(events, 'triggerFired').map((e) => e.towerId)).toEqual([
      reapers[0]!.id,
      reapers[1]!.id,
    ]);
    expect(state.triggers.lastTick).toEqual({ fired: 2, maxDepth: 1, deferred: 0, dropped: 3 });
    expect(state.triggers.droppedTotal).toBe(3);
    run(sim, 1);
    expect(state.triggers.lastTick.dropped).toBe(0);
    expect(state.triggers.droppedTotal).toBe(3);
  });

  it('save no meio de uma cadeia (com a fila pendente) continua igual', () => {
    const data = triggerData({ maxChainDepthPerTick: 2 });
    const original = line(data);
    run(original.sim, 1);
    expect(original.state.triggers.queue).toHaveLength(1);

    const saved = original.sim.serialize();
    const resumed = triggerSim(Simulation.restore(saved).state as RunState, data);
    expect(run(resumed, 6)).toEqual(run(original.sim, 6));
    expect(resumed.serialize()).toBe(original.sim.serialize());
  });
});
