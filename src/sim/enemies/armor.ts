/**
 * Redução de dano pela armadura (decidido para o protótipo):
 * dano = bruto × scale / (scale + armadura). Com scale 100, armadura 50 tira
 * cerca de 33% e armadura 0 não tira nada. O dano nunca chega a zero.
 */

export interface ArmorParams {
  readonly scale: number;
}

export function applyArmor(rawDamage: number, armor: number, params: ArmorParams): number {
  return (rawDamage * params.scale) / (params.scale + armor);
}
