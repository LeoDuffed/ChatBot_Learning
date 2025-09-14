export type Pending =
  | { step: "await_qty"; productId: string; sku: string }
  | { step: "await_confirm"; productId: string; sku: string; qty: number };

type Store = { pending?: Pending };

const mem = new Map<string, Store>();

export function readMem(chatId: string): Store {
  return mem.get(chatId) ?? {};
}

export function writeMem(chatId: string, patch: Partial<Store>) {
  const prev = mem.get(chatId) ?? {};
  const next = { ...prev, ...patch };
  mem.set(chatId, next);
  return next;
}

export function clearMem(chatId: string) {
  mem.delete(chatId);
}
