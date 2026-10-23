// Minimal in-memory per-IP limiter. On serverless hosts each instance has its own
// counter, so treat this as a basic guard, not a strict quota.

const hits = new Map();

export function rateLimit(ip) {
  const limit = parseInt(process.env.RATE_LIMIT_PER_HOUR || "10", 10);
  if (!limit) return true;
  const now = Date.now();
  const windowMs = 3600_000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return true;
}
