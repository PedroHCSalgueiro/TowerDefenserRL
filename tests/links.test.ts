import { describe, expect, it } from 'vitest';
import { classData } from '../src/sim/classes/classData';
import { createRunState, type RunState } from '../src/sim/state';
import { createTower, type Tower } from '../src/sim/towers/placement';
import { towerData } from '../src/sim/towers/towerData';
import { previewLinks, type LinkCandidate } from '../src/sim/triggers/links';

const BOUNDS = { width: 14, height: 14 };

function add(state: RunState, type: string, x: number, y: number, star = 1): Tower {
  const tower = createTower(state.nextEntityId++, type, { x, y });
  tower.star = star;
  state.towers.push(tower);
  return tower;
}

function candidate(
  type: string,
  x: number,
  y: number,
  star = 1,
  movingId: number | null = null,
): LinkCandidate {
  return { type, star, x, y, movingId };
}

/** Ligações como "origem→destino tipo", com `C` para a candidata e o id para as torres do mapa. */
function links(state: RunState, c: LinkCandidate): string[] {
  return previewLinks(state, c, towerData, classData, BOUNDS)
    .links.map((l) => `${l.from.towerId ?? 'C'}→${l.to.towerId ?? 'C'} ${l.kind}`)
    .sort();
}

describe('prévia de ligações ao posicionar ou mover (T23)', () => {
  it('Relé na mão ativa as torres de lado; diagonal e a 2 casas ficam de fora', () => {
    const state = createRunState('links');
    const right = add(state, 'mortar', 6, 5);
    add(state, 'mortar', 6, 6);
    add(state, 'mortar', 7, 5);
    expect(links(state, candidate('relay', 5, 5))).toEqual([`C→${right.id} activates`]);
  });

  it('Arcana: o Relé que completa o bônus (2 Arcanas) já mostra as diagonais', () => {
    const state = createRunState('links');
    const diagonal = add(state, 'mortar', 6, 6);
    expect(links(state, candidate('relay', 5, 5))).toEqual([]);
    add(state, 'ballista', 1, 1); // a segunda Arcana, longe
    expect(links(state, candidate('relay', 5, 5))).toEqual([`C→${diagonal.id} activates`]);
  });

  it('Relé ★3: a cruz de 2 casas entra', () => {
    const state = createRunState('links');
    const far = add(state, 'mortar', 7, 5);
    expect(links(state, candidate('relay', 5, 5, 1))).toEqual([]);
    expect(links(state, candidate('relay', 5, 5, 3))).toEqual([`C→${far.id} activates`]);
  });

  it('chegando: o Relé e o Relógio do mapa ativam a torre na mão; o Obelisco ★3 também', () => {
    const state = createRunState('links');
    const relay = add(state, 'relay', 4, 5);
    const clock = add(state, 'clock', 6, 5);
    const obelisk3 = add(state, 'obelisk', 5, 4, 3);
    expect(links(state, candidate('mortar', 5, 5))).toEqual(
      [
        `${relay.id}→C activates`,
        `${clock.id}→C activates`,
        `${obelisk3.id}→C activates`,
        `C→${obelisk3.id} charges`,
      ].sort(),
    );
  });

  it('Obelisco na mão recebe carga das vizinhas; torre ao lado de um Obelisco dá carga a ele', () => {
    const state = createRunState('links');
    const mortar = add(state, 'mortar', 6, 5);
    expect(links(state, candidate('obelisk', 5, 5))).toEqual([`${mortar.id}→C charges`]);
    const obelisk = add(state, 'obelisk', 8, 8);
    expect(links(state, candidate('reaper', 8, 9))).toEqual([`C→${obelisk.id} charges`]);
  });

  it('Espelho na mão copia as vizinhas; torre ao lado de um Espelho é copiada por ele', () => {
    const state = createRunState('links');
    const mortar = add(state, 'mortar', 6, 5);
    expect(links(state, candidate('mirror', 5, 5))).toEqual([`${mortar.id}→C copies`]);
    const mirror = add(state, 'mirror', 9, 9);
    expect(links(state, candidate('reaper', 9, 10))).toEqual([`C→${mirror.id} copies`]);
  });

  it('sem ligações: duas torres sem gatilho de vizinhança lado a lado', () => {
    const state = createRunState('links');
    add(state, 'mortar', 6, 5);
    expect(links(state, candidate('reaper', 5, 5))).toEqual([]);
  });

  it('torre movida não se liga a si mesma (a posição antiga some)', () => {
    const state = createRunState('links');
    const relay = add(state, 'relay', 5, 5);
    const mortar = add(state, 'mortar', 6, 5);
    // O Relé arrastado para longe do Morteiro: nenhuma ligação, nem com a casa antiga.
    expect(links(state, candidate('relay', 9, 9, 1, relay.id))).toEqual([]);
    // O Morteiro arrastado para o outro lado do Relé continua ligado a ele.
    expect(links(state, candidate('mortar', 4, 5, 1, mortar.id))).toEqual([
      `${relay.id}→C activates`,
    ]);
  });

  it('casas vizinhas: 4; 8 com a Arcana; cruz de 2 com o Relé ★3', () => {
    const state = createRunState('links');
    const cells = (c: LinkCandidate) =>
      previewLinks(state, c, towerData, classData, BOUNDS)
        .neighborCells.map((p) => `${p.x},${p.y}`)
        .sort();
    expect(cells(candidate('relay', 5, 5))).toEqual(['4,5', '5,4', '5,6', '6,5']);
    expect(cells(candidate('relay', 5, 5, 3))).toEqual(
      ['3,5', '4,5', '5,3', '5,4', '5,6', '5,7', '6,5', '7,5'].sort(),
    );
    add(state, 'ballista', 1, 1);
    expect(cells(candidate('relay', 5, 5))).toHaveLength(8);
    // O Morteiro não é Arcana: continua com 4.
    expect(cells(candidate('mortar', 5, 5))).toHaveLength(4);
    // No canto, só as casas dentro do mapa.
    expect(cells(candidate('relay', 0, 0, 1))).toEqual(['0,1', '1,0', '1,1']);
  });
});
