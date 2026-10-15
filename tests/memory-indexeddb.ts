// Minimal asynchronous IDB fixture; structured-clone-capable browser handles are
// represented by identity-preserving mock objects in notebook tests.
export function memoryIndexedDB() {
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  return { open(name: string) {
    const request: any = {};
    queueMicrotask(() => {
      const first = !databases.has(name); const stores = databases.get(name) ?? new Map(); databases.set(name, stores);
      request.result = {
        createObjectStore(store: string) { stores.set(store, new Map()); }, close() {},
        transaction(store: string) {
          const tx: any = {};
          const action = (fn: () => unknown) => {
            const result: any = {};
            queueMicrotask(() => { result.result = fn(); result.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
            return result;
          };
          tx.objectStore = () => ({ get: (key: string) => action(() => stores.get(store)?.get(key)), put: (value: unknown, key: string) => action(() => stores.get(store)!.set(key, value)), delete: (key: string) => action(() => stores.get(store)?.delete(key)) });
          return tx;
        }
      };
      if (first) request.onupgradeneeded?.(); request.onsuccess?.();
    });
    return request;
  } };
}
