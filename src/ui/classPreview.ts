/**
 * Prévia da compra na janela do slot da loja (T16): o que a compra muda nas
 * classes ("Arcana 1/2 → 2/2 (ativa nível 2)") ou, se funde, a estrela nova
 * ("★2↑", e as classes não mudam). Usa a mesma `planFusion` da compra e a
 * mesma contagem de classes da simulação (`countClasses`). Sem DOM.
 */

import type { ClassData } from '../sim/classes/classData';
import { countClasses } from '../sim/classes/systems';
import type { Tower } from '../sim/towers/placement';
import { planFusion } from '../sim/towers/fusion';
import { getTowerType, type TowerData } from '../sim/towers/towerData';

export interface PurchasePreview {
  /** "★2↑" quando a compra funde (`null` = não funde). */
  fusion: string | null;
  /** Uma linha por classe do tipo, só quando a compra traz um tipo novo ao mapa. */
  classes: string[];
}

/** Contagem com `count` torres: "1/2" ou "4 · máx.". */
function countText(count: number, next: number | null): string {
  return next === null ? `${count} · máx.` : `${count}/${next}`;
}

/**
 * Prévia da compra de uma cópia de `towerType` com as torres de agora. `null`
 * quando a compra não muda nada visível (o tipo já está no mapa e não funde).
 * `wildcards`: coringas das recompensas (T24), que entram na contagem.
 */
export function purchasePreview(
  towers: readonly Tower[],
  towerType: string,
  data: TowerData,
  classes: ClassData,
  wildcards: Readonly<Record<string, number>> = {},
): PurchasePreview | null {
  const plan = planFusion(towers, data, towerType);
  if (plan) return { fusion: `★${plan.star}↑`, classes: [] };
  if (towers.some((t) => t.type === towerType)) return null;

  const types = towers.map((t) => t.type);
  const before = countClasses(types, data, classes, wildcards);
  const after = countClasses([...types, towerType], data, classes, wildcards);
  const lines = getTowerType(data, towerType).classes.map((id) => {
    const info = classes.classes[id]!;
    const was = before[id]!;
    const will = after[id]!;
    const extra = wildcards[id] ?? 0;
    const wasCount = was.members.length + extra;
    // O mesmo alvo dos dois lados ("1/2 → 2/2"): o próximo nível a partir de agora.
    const next = info.levels.find((l) => l.count > wasCount)?.count ?? null;
    const lights =
      will.level > was.level ? ` (ativa nível ${info.levels[will.level - 1]!.count})` : '';
    return (
      `${info.name} ${countText(wasCount, next)} → ` +
      `${countText(will.members.length + extra, next)}${lights}`
    );
  });
  return { fusion: null, classes: lines };
}

/** Assinatura da prévia (a janela só refaz o texto quando ela muda). */
export function previewKey(preview: PurchasePreview | null): string {
  return preview === null ? '-' : `${preview.fusion ?? ''}|${preview.classes.join('|')}`;
}
