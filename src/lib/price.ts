/**
 * Visual-only "was" anchor price (~28% higher, rounded to the nearest 10).
 * No backend discount logic — purely a value-perception display value.
 */
export function anchorPrice(price: number): number {
  const value = Math.round((price * 1.28) / 10) * 10;
  return value > price ? value : price + 10;
}
