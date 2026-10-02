/**
 * Pool de inimigos dentro do RunState.
 *
 * Os objetos nunca são destruídos: um inimigo morto ou que chegou ao núcleo
 * volta para a lista livre e é reaproveitado no próximo spawn. Como `slots` e
 * `free` fazem parte do estado salvo, restaurar uma run reproduz exatamente o
 * mesmo reaproveitamento.
 */

export interface Enemy {
  /** Índice fixo do objeto no pool. */
  readonly slot: number;
  active: boolean;
  /** Id único na run (eventos e alvos). Muda a cada reaproveitamento. */
  id: number;
  type: string;
  /** Onda a que o inimigo pertence (a primeira é a 1); 0 = sem onda (debug e estresse). */
  wave: number;
  /** Versão forte do tipo (onda de elite): vida, velocidade e dano no núcleo de `EnemyData.elite`. */
  elite: boolean;
  hp: number;
  maxHp: number;
  /** Distância percorrida na rota, em casas. */
  distance: number;
  /** Posição na grade (fracionária) no tick atual e no anterior. */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
}

export interface EnemyPool {
  slots: Enemy[];
  /** Pilha de slots livres; o próximo spawn usa o último. */
  free: number[];
  activeCount: number;
}

function blankEnemy(slot: number): Enemy {
  return {
    slot,
    active: false,
    id: 0,
    type: '',
    wave: 0,
    elite: false,
    hp: 0,
    maxHp: 0,
    distance: 0,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
  };
}

export function createEnemyPool(capacity: number): EnemyPool {
  const slots: Enemy[] = [];
  const free: number[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push(blankEnemy(i));
  }
  // Ordem decrescente para que os primeiros spawns usem os slots 0, 1, 2...
  for (let i = capacity - 1; i >= 0; i--) {
    free.push(i);
  }
  return { slots, free, activeCount: 0 };
}

/**
 * Marca um slot livre como ativo e o devolve. Se não houver, o pool cresce.
 * Quem chama preenche os campos do inimigo.
 */
export function acquireEnemy(pool: EnemyPool): Enemy {
  let slot = pool.free.pop();
  if (slot === undefined) {
    slot = pool.slots.length;
    pool.slots.push(blankEnemy(slot));
  }
  const enemy = pool.slots[slot]!;
  enemy.active = true;
  pool.activeCount++;
  return enemy;
}

export function releaseEnemy(pool: EnemyPool, enemy: Enemy): void {
  if (!enemy.active) {
    throw new Error(`Inimigo ${enemy.id} (slot ${enemy.slot}) já foi devolvido ao pool`);
  }
  enemy.active = false;
  pool.free.push(enemy.slot);
  pool.activeCount--;
}

/** Devolve todos os inimigos ativos ao pool, sem eventos (limpeza de debug). */
export function releaseAllEnemies(pool: EnemyPool): void {
  for (const enemy of pool.slots) {
    if (enemy.active) releaseEnemy(pool, enemy);
  }
}
