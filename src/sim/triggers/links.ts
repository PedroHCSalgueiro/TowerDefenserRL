/**
 * Prévia das ligações de uma torre ainda na mão (T23): ao posicionar (da
 * loja) ou mover, quais torres vão se ligar a ela naquela casa e como, com a
 * mesma regra de vizinhança do motor (`isReachNeighbor` e o raio da Arcana)
 * e as classes calculadas como se ela já estivesse no mapa.
 *
 * Tipos de ligação (a seta vai de `from` para `to`):
 * - `activates`: `from` ativa `to` (Relé, Relógio, Obelisco ★3);
 * - `charges`: os abates de `from` carregam o Obelisco `to`;
 * - `copies`: o Espelho `to` copia o último efeito de `from`.
 */

import { neighborhoodRadius } from '../classes/bonuses';
import type { ClassData } from '../classes/classData';
import { countClasses } from '../classes/systems';
import { rewardMods } from '../rewards/mods';
import type { RewardsState } from '../rewards/rewardState';
import type { RunState } from '../state';
import { clampStar } from '../towers/stars';
import { getTowerType, type TowerData } from '../towers/towerData';
import { isReachNeighbor } from './neighborhood';
import { triggerAt } from './triggerData';

export type LinkKind = 'activates' | 'charges' | 'copies';

/** Uma ponta da ligação: a candidata (`towerId` = `null`) ou uma torre do mapa. */
export interface LinkEnd {
  readonly towerId: number | null;
  readonly x: number;
  readonly y: number;
}

export interface Link {
  readonly from: LinkEnd;
  readonly to: LinkEnd;
  readonly kind: LinkKind;
}

/** A torre na mão: tipo, estrela, casa e, se for uma torre movida, o id dela. */
export interface LinkCandidate {
  readonly type: string;
  readonly star: number;
  readonly x: number;
  readonly y: number;
  /** Torre do mapa sendo movida (ela não se liga a si mesma; `null` = da loja). */
  readonly movingId: number | null;
}

export interface LinkPreview {
  readonly links: readonly Link[];
  /** Casas vizinhas da candidata (contorno leve), na vizinhança dela naquela casa. */
  readonly neighborCells: readonly { x: number; y: number }[];
}

interface Placed {
  readonly towerId: number | null;
  readonly type: string;
  readonly star: number;
  readonly x: number;
  readonly y: number;
}

interface Role {
  /** Ativa as vizinhas; `reach` > 0 = cruz do Relé ★3. */
  readonly activates: boolean;
  readonly reach: number;
  /** Ganha carga com os abates das vizinhas (Obelisco). */
  readonly charged: boolean;
  /** Copia uma vizinha (Espelho). */
  readonly copies: boolean;
}

function roleOf(towers: TowerData, placed: Placed): Role {
  const type = getTowerType(towers, placed.type);
  if (!type.trigger) return { activates: false, reach: 0, charged: false, copies: false };
  const { when, effect } = triggerAt(type.trigger, clampStar(type, placed.star));
  const activateNeighbors = effect.kind === 'activateNeighbors';
  return {
    activates:
      activateNeighbors || (effect.kind === 'chargeLightning' && effect.activateOnDischarge),
    reach: activateNeighbors ? effect.reach : 0,
    charged: when.kind === 'neighborKills',
    copies: effect.kind === 'copyLast',
  };
}

function endOf(p: Placed): LinkEnd {
  return { towerId: p.towerId, x: p.x, y: p.y };
}

export function previewLinks(
  state: Pick<RunState, 'towers'> & { readonly rewards?: RewardsState },
  candidate: LinkCandidate,
  towers: TowerData,
  classes: ClassData,
  bounds: { width: number; height: number },
): LinkPreview {
  const others: Placed[] = state.towers
    .filter((t) => t.id !== candidate.movingId)
    .map((t) => ({ towerId: t.id, type: t.type, star: t.star, x: t.x, y: t.y }));
  const self: Placed = { towerId: null, ...candidate };
  // As classes como ficariam com a candidata no mapa (mover não muda os tipos).
  const classState = {
    classes: countClasses(
      [...others.map((o) => o.type), self.type],
      towers,
      classes,
      rewardMods(state).wildcards,
    ),
  };
  const { neighborhood } = towers.triggers;
  const radiusOf = (p: Placed) =>
    neighborhoodRadius(classes, classState, getTowerType(towers, p.type));
  /** `b` está na vizinhança de `a` (com o raio de `a` e, se pedido, a cruz `reach`). */
  const near = (a: Placed, b: Placed, reach = 0) =>
    isReachNeighbor(a, b, neighborhood, radiusOf(a), reach);

  const links: Link[] = [];
  const add = (from: Placed, to: Placed, kind: LinkKind) =>
    links.push({ from: endOf(from), to: endOf(to), kind });
  const selfRole = roleOf(towers, self);
  for (const other of others) {
    const role = roleOf(towers, other);
    // Saindo da candidata.
    if (selfRole.activates && near(self, other, selfRole.reach)) add(self, other, 'activates');
    if (role.charged && near(other, self)) add(self, other, 'charges');
    if (role.copies && near(other, self)) add(self, other, 'copies');
    // Chegando nela.
    if (role.activates && near(other, self, role.reach)) add(other, self, 'activates');
    if (selfRole.charged && near(self, other)) add(other, self, 'charges');
    if (selfRole.copies && near(self, other)) add(other, self, 'copies');
  }

  // As casas vizinhas da candidata, na vizinhança que ela usa (com a cruz do Relé ★3).
  const neighborCells: { x: number; y: number }[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      if (near(self, { towerId: null, type: self.type, star: 1, x, y }, selfRole.reach)) {
        neighborCells.push({ x, y });
      }
    }
  }
  return { links, neighborCells };
}
