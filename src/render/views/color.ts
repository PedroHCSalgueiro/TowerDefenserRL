/** Converte "#rrggbb" (formato do render.json) no número que o Phaser usa. */
export function hexColor(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
