export type ParsedOrder = { sku: string; qty: number };

// Un SKU probable debe tener dígitos o separadores (evita palabras comunes como "QUIERO")
export function isLikelySku(token: string) {
  const t = token.toUpperCase().trim();
  if (!/^[A-Z0-9._-]+$/.test(t)) return false;
  if (/[0-9]/.test(t)) return true;
  if (/[._-]/.test(t)) return true;
  return false;
}

export function parseOrder(text: string): ParsedOrder | null {
  const t = text.trim();

  // a) "quiero 2 de SKU" / "comprar 2 SKU" / "compra 2 SKU"
  const reA = /\b(?:quiero|compra(?:r)?)\s+(\d+)\s+(?:de\s+)?([A-Za-z0-9._-]{2,})\b/i;
  const mA = t.match(reA);
  if (mA) {
    const qty = Math.max(1, parseInt(mA[1], 10));
    const sku = mA[2].toUpperCase();
    if (isLikelySku(sku)) return { sku, qty };
  }

  // b) "SKU x2"
  const reB = /\b([A-Za-z0-9._-]{2,})\s*[xX]\s*(\d+)\b/;
  const mB = t.match(reB);
  if (mB) {
    const sku = mB[1].toUpperCase();
    const qty = Math.max(1, parseInt(mB[2], 10));
    if (isLikelySku(sku)) return { sku, qty };
  }

  // c) Sólo "SKU" (solo si parece SKU real)
  const reC = /\b([A-Za-z0-9._-]{2,})\b/;
  const mC = t.match(reC);
  if (mC) {
    const sku = mC[1].toUpperCase();
    if (isLikelySku(sku)) return { sku, qty: 1 };
  }

  return null;
}
