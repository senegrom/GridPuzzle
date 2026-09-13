// Single-context IndexedDB fixture. Cross-tab ordering is tested with real
// browser tabs, IndexedDB transactions and Web Locks in the browser gate.
export function memoryStore(initial) {
  const records = new Map(initial === undefined ? [] : [["latest", initial]]), held = [];
  let holdNext = false, transactions = 0, writes = 0;
  const queue = [];
  const db = { objectStoreNames: { contains: () => true }, close() {}, transaction() {
    transactions++;
    const state = { pending: [], active: false, ended: false, staged: null };
    const tx = { abort() { if (state.ended) return; finish(true); tx.onabort?.(); }, objectStore() {
      return {
        get(key) { return request(() => state.staged.get(key)); },
        put(value, key) { return request(() => { state.staged.set(key, structuredClone(value)); if (key === "latest") writes++; }); },
        delete(key) { return request(() => state.staged.delete(key)); },
      };
    }};
    function finish(aborted = false) {
      if (state.ended) return;
      state.ended = true;
      if (!aborted) { records.clear(); for (const entry of state.staged) records.set(...entry); }
      queue.splice(queue.indexOf(run), 1);
      queueMicrotask(() => queue[0]?.());
    }
    function run() {
      if (state.ended) return;
      if (!state.active) { state.active = true; state.staged = new Map(records); }
      while (state.pending.length && !state.ended) {
        const [req, action] = state.pending.shift();
        req.result = action(); req.onsuccess?.();
      }
      if (!state.ended) { finish(); tx.oncomplete?.(); }
    }
    function request(action) { const req = {}; state.pending.push([req, action]); return req; }
    queue.push(run); queueMicrotask(() => { if (queue[0] === run) run(); });
    return tx;
  }};
  return {
    indexedDB: { open() { const req = { result: db }; if (holdNext) { holdNext = false; held.push(req); }
      else queueMicrotask(() => req.onsuccess?.()); return req; } },
    // Existing single-context tests exercise ownership checks without requiring
    // a browser. Do not use this stub as evidence for cross-context locking.
    locks: { request(_name, _options, callback) { return Promise.resolve(callback()); } },
    hold() { holdNext = true; }, release() { held.shift().onsuccess(); },
    get record() { return records.get("latest"); },
    get transactions() { return transactions; }, get writes() { return writes; },
  };
}
