const runtimeCache = new Map();

const now = () => Date.now();

export function getRuntimeCachedValue(key) {
  const entry = runtimeCache.get(key);
  if (!entry || entry.expiresAt <= now() || entry.promise) return null;
  return entry.value;
}

export async function withRuntimeCache(key, loader, ttl = 120_000) {
  const entry = runtimeCache.get(key);
  if (entry && entry.expiresAt > now()) {
    if (entry.promise) return entry.promise;
    return entry.value;
  }

  const promise = Promise.resolve().then(loader);
  runtimeCache.set(key, { promise, value: null, expiresAt: now() + ttl });
  try {
    const value = await promise;
    runtimeCache.set(key, { promise: null, value, expiresAt: now() + ttl });
    return value;
  } catch (error) {
    if (runtimeCache.get(key)?.promise === promise) runtimeCache.delete(key);
    throw error;
  }
}

export function primeRuntimeCache(key, value, ttl = 120_000) {
  runtimeCache.set(key, { promise: null, value, expiresAt: now() + ttl });
  return value;
}

export function invalidateRuntimeCache(prefix = "") {
  for (const key of runtimeCache.keys()) {
    if (!prefix || key.startsWith(prefix)) runtimeCache.delete(key);
  }
}

export function clearRuntimeCache() {
  runtimeCache.clear();
}
