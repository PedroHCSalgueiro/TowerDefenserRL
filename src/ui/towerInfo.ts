/**
 * Texto da janela de uma torre ("o que ela faz"), montado a partir dos
 * números de `towers.json` na estrela pedida: o texto nunca fica diferente do
 * jogo. Sem DOM, para testar direto.
 */

import type { ClassData } from '../sim/classes/classData';
import { clampStar, maxStars } from '../sim/towers/stars';
import type { TowerType } from '../sim/towers/towerData';
import { triggerAt, type TriggerEffect, type TriggerWhen } from '../sim/triggers/triggerData';
import { RARITY_LABELS } from './shopModel';

export interface TowerInfo {
  /** "Relé ★2" */
  title: string;
  /** "Arcana · Mecânica · Comum" */
  subtitle: string;
  /** Ataque normal. */
  attack: string;
  /** O que o gatilho faz (`null` = torre sem gatilho). */
  trigger: string | null;
}

/** Número no formato brasileiro, sem casas sobrando (0,8 · 1,3 · 8). */
export function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

function whenText(when: TriggerWhen): string {
  switch (when.kind) {
    case 'everyNShots':
      return `A cada ${fmt(when.shots)} tiros`;
    case 'enemyDiesInRange':
      return 'Quando um inimigo morre no alcance';
    case 'onFire':
      return 'Sempre que atira';
    case 'onActivated':
      return 'Quando uma vizinha a ativa';
    case 'neighborKills':
      return 'Quando uma vizinha abate um inimigo';
    case 'everyNKillsInRange':
      return `A cada ${fmt(when.kills)} abates no alcance`;
  }
}

function effectText(effect: TriggerEffect): string {
  switch (effect.kind) {
    case 'multiShot':
      return `dispara ${plural(effect.extraShots, 'tiro extra', 'tiros extras')}${
        effect.spread ? ', cada um em um alvo diferente' : ''
      }`;
    case 'explosion':
      return `explode (raio ${fmt(effect.radius)}, ${fmt(effect.damagePercent)}% do dano)${
        effect.killWeight > 1
          ? `; as mortes da explosão contam como ${plural(effect.killWeight, 'abate', 'abates')}`
          : ''
      }`;
    case 'activateNeighbors': {
      const who =
        effect.maxTargets > 0
          ? `até ${plural(effect.maxTargets, 'vizinha', 'vizinhas')}`
          : 'todas as vizinhas';
      const reach = effect.reach > 0 ? ` (alcance ampliado em ${fmt(effect.reach)})` : '';
      const self = effect.selfToo ? ' e a si mesma' : '';
      const shot =
        effect.activatedDamagePercent === 100
          ? ''
          : `, com ${fmt(effect.activatedDamagePercent)}% do dano`;
      return `ativa ${who}${reach}${self}; cada uma dá um tiro extra${shot}`;
    }
    case 'chargeLightning':
      return (
        `carrega o raio. Com ${plural(effect.charges, 'carga', 'cargas')}, solta um raio em ` +
        `${plural(effect.targets, 'inimigo', 'inimigos')} (salto de ${fmt(effect.jumpRadius)} casas, ` +
        `${fmt(effect.damagePercent)}% do dano)` +
        (effect.activateOnDischarge ? ' e ativa as vizinhas' : '')
      );
    case 'pierceLine':
      return (
        `dispara uma linha${effect.unlimited ? ' que atravessa todo o mapa' : ''} ` +
        `(largura ${fmt(effect.halfWidth * 2)}, ${fmt(effect.damagePercent)}% do dano)`
      );
    case 'execute': {
      const boss =
        effect.bossMaxHpPercent > 0
          ? `; no chefão, dá um golpe de ${fmt(effect.bossMaxHpPercent)}% da vida máxima`
          : '; o chefão é poupado';
      const blast =
        effect.explodeRadius > 0
          ? `; cada execução explode (raio ${fmt(effect.explodeRadius)}, ${fmt(effect.explodeDamagePercent)}% do dano)`
          : '';
      return `executa o inimigo com menos de ${fmt(effect.hpPercent)}% da vida (a morte conta como ${plural(effect.killWeight, 'abate', 'abates')})${boss}${blast}`;
    }
    case 'copyLast': {
      const from =
        effect.copies > 1
          ? `os últimos efeitos de ${fmt(effect.copies)} vizinhas diferentes`
          : 'o último efeito de uma vizinha';
      const power = effect.powerPercent === 100 ? '' : `, com ${fmt(effect.powerPercent)}% do dano`;
      return `copia ${from}${power}`;
    }
  }
}

/** Informações da torre `type` na estrela `star` (presa entre ★1 e a última do tipo). */
export function describeTower(type: TowerType, star: number, classes: ClassData): TowerInfo {
  const s = clampStar(type, star);
  const def = type.trigger ? triggerAt(type.trigger, s) : null;
  const title = maxStars(type) > 1 ? `${type.name} ★${s}` : type.name;
  const subtitle = [
    ...type.classes.map((id) => classes.classes[id]?.name ?? id),
    ...(type.rarity ? [RARITY_LABELS[type.rarity]] : []),
  ].join(' · ');

  const damage = (type.damage * (def?.attackDamagePercent ?? 100)) / 100;
  const area = type.shot.kind === 'area' ? `, área de raio ${fmt(type.shot.radius)}` : '';
  const attack = type.attacks
    ? `Dano ${fmt(damage)} · ${plural(type.shotsPerSecond, 'tiro', 'tiros')}/s · alcance ${fmt(type.range)}${area}`
    : 'Não ataca por conta própria';

  return {
    title,
    subtitle,
    attack,
    trigger: def ? `${whenText(def.when)}: ${effectText(def.effect)}.` : null,
  };
}
