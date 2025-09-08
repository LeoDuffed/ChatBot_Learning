export function normalize(str: string) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Stopwords básicas (no quitamos nombres de productos: playera, pantalon, etc.)
const STOPWORDS = new Set([
  "hola","buenas","buenos","dias","tardes","noches",
  "el","la","los","las","un","una","unos","unas",
  "de","del","al","a","en","y","o","u","con","para","por",
  "que","qué","como","cómo","cual","cuál","donde","dónde",
  "tengo","hay","queda","quedan","disponible","disponibles",
  "quiero","comprar","compra","me","interesa","tu","tú","mi","su",
  "si","sí","no"
]);

export function extractKeywords(text: string): string[] {
  const t = normalize(text).replace(/[^a-z0-9._-\s]/g, " ");
  return t
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .slice(0, 6);
}

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, un: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

export function parseQuantityFromText(text: string): number | null {
  const t = normalize(text);
  const mNum = t.match(/\b(\d{1,3})\b/);
  if (mNum) return Math.max(1, parseInt(mNum[1], 10));
  const mWord = t.match(
    /\b(uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/
  );
  if (mWord) return NUMBER_WORDS[mWord[1]] ?? null;
  return null;
}

export type Intent =
  | "buy"
  | "ask_inventory"
  | "ask_availability"
  | "ask_stock"
  | "ask_price"
  | null;

export function detectIntent(text: string): Intent {
  const t = normalize(text);

  // compra
  if (/\b(quiero|comprar|compra|me\s+lo\s+llevo|me\s+llevo|agrega|añade|sumar)\b/.test(t)) {
    return "buy";
  }
  // inventario general
  if (/\b(que\s+tienes|qué\s+tienes|que\s+vendes|catalogo|catálogo|muestrame|muéstrame|mostrar)\b/.test(t)) {
    return "ask_inventory";
  }
  // disponibilidad / stock / precio
  if (/\b(tienes|hay|manejas|vendes|disponible|disponibles)\b/.test(t)) {
    if (/\b(precio|cuanto\s+cuesta|cuánto\s+cuesta|vale|coste)\b/.test(t)) return "ask_price";
    if (/\b(cuantos|cuantas|cuánto|cuantos\s+te\s+quedan|stock|quedan?)\b/.test(t)) return "ask_stock";
    return "ask_availability";
  }
  if (/\b(precio|cuanto\s+cuesta|cuánto\s+cuesta|vale|coste)\b/.test(t)) return "ask_price";

  return null;
}
