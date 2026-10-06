/**
 * Painel lateral das classes, em HTML sobre o canvas: cada classe com a
 * contagem atual e o próximo nível (ex.: "Arcana 3/4"), o nível ativo em
 * destaque e, ao passar o mouse, o texto dos níveis e as torres que contam.
 */

import { classData } from '../sim/classes/classData';
import type { ClassState } from '../sim/classes/classState';
import { towerData } from '../sim/towers/towerData';
import { buildClassRows, classRowsKey, type ClassRow } from './classPanelModel';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderRow(row: ClassRow): HTMLElement {
  const root = el('div', `class-row${row.level > 0 ? ' class-active' : ''}`);
  root.dataset.classId = row.id;
  root.append(el('div', 'class-label', row.label));
  const tip = el('div', 'class-tip');
  for (const level of row.levels) {
    tip.append(
      el(
        'div',
        `class-level${level.active ? ' class-level-active' : ''}`,
        `Nível ${level.count}: ${level.text}`,
      ),
    );
  }
  tip.append(
    el(
      'div',
      'class-members',
      row.members.length > 0 ? `Contando: ${row.members.join(', ')}` : 'Nenhuma torre contando',
    ),
  );
  root.append(tip);
  return root;
}

export class ClassPanel {
  private readonly root: HTMLElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'class-panel');
    this.root.setAttribute('aria-label', 'Classes');
    parent.append(this.root);
  }

  /**
   * Chame a cada quadro: só refaz o DOM quando contagem ou nível mudaram.
   * `wildcards`: coringas das recompensas por classe (T24).
   */
  update(state: Readonly<ClassState>, wildcards: Readonly<Record<string, number>> = {}): void {
    const rows = buildClassRows(state, classData, towerData, wildcards);
    const key = classRowsKey(rows);
    if (key === this.key) return;
    this.key = key;
    this.root.replaceChildren(...rows.map(renderRow));
  }

  destroy(): void {
    this.root.remove();
  }
}
