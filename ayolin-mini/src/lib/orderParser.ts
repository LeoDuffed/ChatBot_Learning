export type ParsedOrder = { sku: string;   qty: number }  

const NUM_WORDS: Record<string, number> = {
  uno: 1, una: 1, un: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
}  

function toNumberMaybe(token: string): number | null {
  const t = token.toLowerCase()  
  if (/^\d{1,3}$/.test(t)) return Math.max(1, parseInt(t, 10))  
  if (t in NUM_WORDS) return NUM_WORDS[t]  
  return null  
}

export function isLikelySku(token: string) {
  const t = token.toUpperCase().trim()  
  if (!/^[A-Z0-9._-]+$/.test(t)) return false  
  if (/[0-9]/.test(t)) return true  
  if (/[._-]/.test(t)) return true  
  return false  
}

export function parseOrder(text: string): ParsedOrder | null {
  const t = text.trim()  

  // "quiero 2|dos de SKU" / "comprar 2|dos SKU"
  const reA = /\b(?:quiero|comprar|compra)\s+(\d+|uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:de\s+)?([A-Za-z0-9._-]{2,})\b/i  
  const mA = t.match(reA)  
  if (mA) {
    const qty = toNumberMaybe(mA[1]) ?? 1  
    const sku = mA[2].toUpperCase()  
    if (isLikelySku(sku)) return { sku, qty: Math.max(1, qty) }  
  }

  // "SKU x2"
  const reB = /\b([A-Za-z0-9._-]{2,})\s*[xX]\s*(\d+)\b/  
  const mB = t.match(reB)  
  if (mB) {
    const sku = mB[1].toUpperCase()  
    const qty = Math.max(1, parseInt(mB[2], 10))  
    if (isLikelySku(sku)) return { sku, qty }  
  }

  // Token scan: usa el primer token que parezca SKU → qty=1
  const tokens = t.match(/[A-Za-z0-9._-]{2,}/g) || []  
  for (const tok of tokens) {
    const sku = tok.toUpperCase()  
    if (isLikelySku(sku)) return { sku, qty: 1 }  
  }

  return null  
}
