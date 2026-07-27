const POSITIVE_INFINITY = '__PT_POSITIVE_INFINITY__';
const NEGATIVE_INFINITY = '__PT_NEGATIVE_INFINITY__';

export function stringifyNetwork(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === Infinity) return POSITIVE_INFINITY;
    if (item === -Infinity) return NEGATIVE_INFINITY;
    return item;
  });
}

export function parseNetwork<T>(text: string): T {
  return JSON.parse(text, (_key, item: unknown) => {
    if (item === POSITIVE_INFINITY) return Infinity;
    if (item === NEGATIVE_INFINITY) return -Infinity;
    return item;
  }) as T;
}
