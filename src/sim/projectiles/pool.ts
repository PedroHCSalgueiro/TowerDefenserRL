/**
 * Pool de projéteis dentro do RunState, no mesmo padrão do pool de inimigos:
 * objetos reaproveitados, nunca destruídos, e salvos junto com a run.
 */

export interface Projectile {
  /** Índice fixo do objeto no pool. */
  readonly slot: number;
  active: boolean;
  id: number;
  /** Quem disparou (id da torre). */
  sourceId: number;
  /** Cadeia do gatilho que disparou o tiro (0 = tiro normal, sem cadeia). */
  chainId: number;
  /** Torre que começou essa cadeia (`null` = núcleo ou sem cadeia). */
  originTowerId: number | null;
  /** Alvo: id do inimigo e o slot onde ele mora (o id confirma que é o mesmo). */
  targetId: number;
  targetSlot: number;
  /**
   * Última posição conhecida do alvo. Se ele morrer (ou chegar ao núcleo)
   * antes do impacto, é o ponto de onde sai a busca por um alvo novo.
   */
  targetX: number;
  targetY: number;
  /** Já trocou de alvo uma vez (não troca de novo). */
  retargeted: boolean;
  damage: number;
  /** Raio do tiro em área, em casas; 0 = tiro único. */
  areaRadius: number;
  /** Velocidade em casas por segundo. */
  speed: number;
  /** Posição na grade no tick atual e no anterior. */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
}

export interface ProjectilePool {
  slots: Projectile[];
  /** Pilha de slots livres; o próximo disparo usa o último. */
  free: number[];
  activeCount: number;
}

function blankProjectile(slot: number): Projectile {
  return {
    slot,
    active: false,
    id: 0,
    sourceId: 0,
    chainId: 0,
    originTowerId: null,
    targetId: 0,
    targetSlot: 0,
    targetX: 0,
    targetY: 0,
    retargeted: false,
    damage: 0,
    areaRadius: 0,
    speed: 0,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
  };
}

export function createProjectilePool(capacity: number): ProjectilePool {
  const slots: Projectile[] = [];
  const free: number[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push(blankProjectile(i));
  }
  for (let i = capacity - 1; i >= 0; i--) {
    free.push(i);
  }
  return { slots, free, activeCount: 0 };
}

/** Marca um slot livre como ativo e o devolve. Se não houver, o pool cresce. */
export function acquireProjectile(pool: ProjectilePool): Projectile {
  let slot = pool.free.pop();
  if (slot === undefined) {
    slot = pool.slots.length;
    pool.slots.push(blankProjectile(slot));
  }
  const projectile = pool.slots[slot]!;
  projectile.active = true;
  pool.activeCount++;
  return projectile;
}

export function releaseProjectile(pool: ProjectilePool, projectile: Projectile): void {
  if (!projectile.active) {
    throw new Error(`Projétil ${projectile.id} (slot ${projectile.slot}) já foi devolvido ao pool`);
  }
  projectile.active = false;
  pool.free.push(projectile.slot);
  pool.activeCount--;
}

/** Devolve todos os projéteis ativos ao pool. */
export function releaseAllProjectiles(pool: ProjectilePool): void {
  for (const projectile of pool.slots) {
    if (projectile.active) releaseProjectile(pool, projectile);
  }
}
