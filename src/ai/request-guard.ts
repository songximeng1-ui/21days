type AiRequestGuardOptions = {
  maxRequestBytes?: number;
  maxStringLength?: number;
  sessionRateLimit?: number;
  sessionDailyLimit?: number;
  globalRateLimit?: number;
  globalDailyLimit?: number;
  sessionConcurrentLimit?: number;
  globalConcurrentLimit?: number;
  sessionTtlMs?: number;
  maxTrackedSessions?: number;
};

type SessionUsage = {
  minuteStartMs: number;
  minuteCount: number;
  day: string;
  dayCount: number;
  inFlight: number;
  lastSeenMs: number;
};

export type AiSession = {
  sessionId: string;
  cookieValue?: string;
  shouldSetCookie: boolean;
};

const UNTRUSTED_SESSION = ":untrusted";

export class AiRequestGuardError extends Error {
  constructor(
    readonly status: 400 | 403 | 413 | 415 | 422 | 429 | 503,
    readonly retryAfterSeconds?: number,
  ) {
    super("AI request rejected");
    this.name = "AiRequestGuardError";
  }

}

export class AiRequestGuard {
  readonly maxRequestBytes: number;
  private readonly maxStringLength: number;
  private readonly sessionRateLimit: number;
  private readonly sessionDailyLimit: number;
  private readonly globalRateLimit: number;
  private readonly globalDailyLimit: number;
  private readonly sessionConcurrentLimit: number;
  private readonly globalConcurrentLimit: number;
  private readonly sessionTtlMs: number;
  private readonly maxTrackedSessions: number;
  private readonly sessions = new Map<string, SessionUsage>();
  private globalDay = "";
  private globalDayCount = 0;
  private globalMinuteStartMs = 0;
  private globalMinuteCount = 0;
  private globalInFlight = 0;

  constructor(options: AiRequestGuardOptions = {}) {
    this.maxRequestBytes = boundedInteger(options.maxRequestBytes, 64 * 1024, 128, 1024 * 1024);
    this.maxStringLength = boundedInteger(options.maxStringLength, 12_000, 256, 32_000);
    this.sessionRateLimit = boundedInteger(options.sessionRateLimit, 6, 1, 100);
    this.sessionDailyLimit = boundedInteger(options.sessionDailyLimit, 30, 1, 1000);
    this.globalRateLimit = boundedInteger(options.globalRateLimit, 60, 1, 10_000);
    this.globalDailyLimit = boundedInteger(options.globalDailyLimit, 500, 1, 100_000);
    this.sessionConcurrentLimit = boundedInteger(options.sessionConcurrentLimit, 1, 1, 10);
    this.globalConcurrentLimit = boundedInteger(options.globalConcurrentLimit, 8, 1, 100);
    this.sessionTtlMs = boundedInteger(options.sessionTtlMs, 86_400_000, 1_000, 7 * 86_400_000);
    this.maxTrackedSessions = boundedInteger(options.maxTrackedSessions, 10_000, 100, 100_000);
  }

  assertTrustedJsonRequest(request: Request): void {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new AiRequestGuardError(415);
    }
    if (request.headers.get("Sec-Fetch-Site")?.toLowerCase() === "cross-site") {
      throw new AiRequestGuardError(403);
    }
    const internalUrl = new URL(request.url);
    const publicHost = normalizeHost(request.headers.get("Host"), internalUrl.protocol);
    if (request.headers.has("Host") && !publicHost) {
      throw new AiRequestGuardError(403);
    }
    const internalHost = internalUrl.host.toLowerCase();
    const origin = request.headers.get("Origin");
    if (!origin) {
      // Non-browser/server clients are allowed without Origin only when they do not
      // override Host, or when Host is exactly the URL host.
      if (publicHost && publicHost !== internalHost) {
        throw new AiRequestGuardError(403);
      }
      return;
    }
    if (origin) {
      let originUrl: URL;
      try {
        originUrl = new URL(origin);
      } catch {
        throw new AiRequestGuardError(403);
      }
      if (publicHost && originUrl.host.toLowerCase() !== publicHost) {
        throw new AiRequestGuardError(403);
      }
      const matchesInternalOrigin = originUrl.origin === internalUrl.origin;
      const matchesPublicHost =
        Boolean(publicHost) &&
        originUrl.host.toLowerCase() === publicHost &&
        originUrl.protocol === internalUrl.protocol &&
        isAllowedDevelopmentHostAlias(internalUrl.hostname, originUrl.hostname);
      if (!matchesInternalOrigin && !matchesPublicHost) {
        throw new AiRequestGuardError(403);
      }
    }
  }

  readSession(request: Request, nowMs = Date.now()): AiSession {
    this.cleanupSessions(nowMs);
    const cookie = request.headers.get("Cookie") ?? "";
    const candidate = cookie.match(/(?:^|;\s*)ai_session=([a-zA-Z0-9_-]{8,80})(?:;|$)/)?.[1];
    const known = candidate ? this.sessions.get(candidate) : undefined;
    if (candidate && known) {
      known.lastSeenMs = nowMs;
      return {
        sessionId: candidate,
        cookieValue: candidate,
        shouldSetCookie: false,
      };
    }

    return {
      sessionId: UNTRUSTED_SESSION,
      shouldSetCookie: false,
    };
  }

  establishSession(session: AiSession, nowMs = Date.now()): AiSession {
    if (!isSharedSession(session.sessionId)) return session;
    return {
      sessionId: session.sessionId,
      cookieValue: this.issueSession(nowMs),
      shouldSetCookie: true,
    };
  }

  async readJson(request: Request, signal: AbortSignal = request.signal): Promise<unknown> {
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxRequestBytes) {
      throw new AiRequestGuardError(413);
    }
    const reader = request.body?.getReader();
    if (!reader) throw new AiRequestGuardError(400);
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let text = "";
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort(
      signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"),
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > this.maxRequestBytes) {
          await reader.cancel();
          throw new AiRequestGuardError(413);
        }
        text += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    text += decoder.decode();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiRequestGuardError(400);
    }
    validateJsonBounds(parsed, this.maxStringLength);
    return parsed;
  }

  acquire(sessionId: string, nowMs = Date.now()): () => void {
    this.cleanupSessions(nowMs);
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (this.globalDay !== day) {
      this.globalDay = day;
      this.globalDayCount = 0;
    }
    const existing = this.sessions.get(sessionId);
    const usage: SessionUsage = existing?.day === day
      ? existing
      : {
          minuteStartMs: nowMs,
          minuteCount: 0,
          day,
          dayCount: 0,
          inFlight: existing?.inFlight ?? 0,
          lastSeenMs: nowMs,
        };
    if (nowMs - usage.minuteStartMs >= 60_000) {
      usage.minuteStartMs = nowMs;
      usage.minuteCount = 0;
    }
    if (nowMs - this.globalMinuteStartMs >= 60_000) {
      this.globalMinuteStartMs = nowMs;
      this.globalMinuteCount = 0;
    }
    usage.lastSeenMs = nowMs;
    this.sessions.set(sessionId, usage);

    if (usage.inFlight >= this.sessionConcurrentLimit || this.globalInFlight >= this.globalConcurrentLimit) {
      throw new AiRequestGuardError(503, 1);
    }
    if (usage.minuteCount >= this.sessionRateLimit) {
      throw new AiRequestGuardError(429, Math.max(1, Math.ceil((usage.minuteStartMs + 60_000 - nowMs) / 1000)));
    }
    if (this.globalMinuteCount >= this.globalRateLimit) {
      throw new AiRequestGuardError(
        429,
        Math.max(1, Math.ceil((this.globalMinuteStartMs + 60_000 - nowMs) / 1000)),
      );
    }
    if (usage.dayCount >= this.sessionDailyLimit || this.globalDayCount >= this.globalDailyLimit) {
      const nextDayMs = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
      throw new AiRequestGuardError(429, Math.max(1, Math.ceil((nextDayMs - nowMs) / 1000)));
    }

    usage.minuteCount += 1;
    usage.dayCount += 1;
    usage.inFlight += 1;
    this.globalMinuteCount += 1;
    this.globalDayCount += 1;
    this.globalInFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      usage.inFlight = Math.max(0, usage.inFlight - 1);
      this.globalInFlight = Math.max(0, this.globalInFlight - 1);
    };
  }

  private issueSession(nowMs: number): string {
    this.cleanupSessions(nowMs, true);
    let sessionId = createOpaqueSessionId();
    while (this.sessions.has(sessionId)) sessionId = createOpaqueSessionId();
    const day = new Date(nowMs).toISOString().slice(0, 10);
    this.sessions.set(sessionId, {
      minuteStartMs: nowMs,
      minuteCount: 0,
      day,
      dayCount: 0,
      inFlight: 0,
      lastSeenMs: nowMs,
    });
    return sessionId;
  }

  private cleanupSessions(nowMs: number, reserveSlot = false): void {
    for (const [sessionId, usage] of this.sessions) {
      if (
        !isSharedSession(sessionId) &&
        usage.inFlight === 0 &&
        nowMs - usage.lastSeenMs > this.sessionTtlMs
      ) {
        this.sessions.delete(sessionId);
      }
    }

    const targetSize = reserveSlot ? this.maxTrackedSessions - 1 : this.maxTrackedSessions;
    if (this.sessions.size <= targetSize) return;
    const evictable = [...this.sessions.entries()]
      .filter(([sessionId, usage]) => !isSharedSession(sessionId) && usage.inFlight === 0)
      .sort((left, right) => left[1].lastSeenMs - right[1].lastSeenMs);
    for (const [sessionId] of evictable) {
      if (this.sessions.size <= targetSize) break;
      this.sessions.delete(sessionId);
    }
  }
}

function normalizeHost(value: string | null, protocol: string): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  try {
    const parsed = new URL(`${protocol}//${trimmed}`);
    return parsed.host.toLowerCase() === trimmed ? parsed.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isAllowedDevelopmentHostAlias(
  internalHostname: string,
  publicHostname: string,
): boolean {
  return isLoopbackHostname(internalHostname) && isLoopbackHostname(publicHostname);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function createOpaqueSessionId(): string {
  return globalThis.crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, "");
}

function isSharedSession(sessionId: string): boolean {
  return sessionId === UNTRUSTED_SESSION;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value as number), max));
}

function validateJsonBounds(value: unknown, maxStringLength: number, depth = 0): void {
  if (depth > 6) throw new AiRequestGuardError(400);
  if (typeof value === "string") {
    if (value.length > maxStringLength) throw new AiRequestGuardError(413);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) throw new AiRequestGuardError(400);
    value.forEach((item) => validateJsonBounds(item, maxStringLength, depth + 1));
    return;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length > 32) throw new AiRequestGuardError(400);
    entries.forEach(([, child]) => validateJsonBounds(child, maxStringLength, depth + 1));
  }
}
