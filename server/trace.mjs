import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** Run fn with a fresh trace array attached to the async context. */
export function withTrace(fn) {
  const trace = [];
  return storage.run(trace, async () => {
    try {
      return { result: await fn(), trace };
    } catch (err) {
      err.trace = trace;
      throw err;
    }
  });
}

export function recordTrace(entry) {
  const trace = storage.getStore();
  if (trace) trace.push(entry);
}
