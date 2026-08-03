import { describe, expect, it } from "vitest";
import { AiRequestGuard, AiRequestGuardError } from "@/ai/request-guard";

describe("AiRequestGuard sessions", () => {
  it("keeps cookie-less visitors in one bootstrap bucket until a cookie is established", () => {
    const guard = new AiRequestGuard();
    const first = guard.readSession(makeRequest());
    const second = guard.readSession(makeRequest());

    expect(first.shouldSetCookie).toBe(false);
    expect(first.cookieValue).toBeUndefined();
    expect(first.sessionId).toBe(second.sessionId);

    const established = guard.establishSession(first, 1_000);
    expect(established.shouldSetCookie).toBe(true);
    expect(established.cookieValue).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
    const returning = guard.readSession(makeRequest(established.cookieValue), 1_001);
    expect(returning).toEqual({
      sessionId: established.cookieValue,
      cookieValue: established.cookieValue,
      shouldSetCookie: false,
    });
  });

  it("puts forged cookie rotation into one limited session bucket", () => {
    const guard = new AiRequestGuard({
      sessionRateLimit: 1,
      sessionDailyLimit: 10,
      globalDailyLimit: 10,
    });
    const first = guard.readSession(makeRequest("forged-session-one"));
    const second = guard.readSession(makeRequest("forged-session-two"));

    expect(first.sessionId).toBe(second.sessionId);
    guard.acquire(first.sessionId, 1_000)();
    expect(() => guard.acquire(second.sessionId, 1_001)).toThrowError(
      expect.objectContaining({ status: 429 }) as AiRequestGuardError,
    );
  });

  it("does not let discarded cookies rotate past the bootstrap session budget", () => {
    const guard = new AiRequestGuard({
      sessionDailyLimit: 1,
      sessionRateLimit: 10,
      globalDailyLimit: 10,
    });
    const first = guard.readSession(makeRequest());
    const second = guard.readSession(makeRequest());

    expect(first.sessionId).toBe(second.sessionId);
    guard.acquire(first.sessionId, 1_000)();
    expect(() => guard.acquire(second.sessionId, 1_001)).toThrowError(
      expect.objectContaining({ status: 429 }) as AiRequestGuardError,
    );
  });

  it("caps cookie-less session rotation with one global minute bucket", () => {
    const guard = new AiRequestGuard({
      sessionRateLimit: 10,
      sessionDailyLimit: 10,
      globalRateLimit: 2,
      globalDailyLimit: 10,
    });
    const sessions = [
      guard.readSession(makeRequest()),
      guard.readSession(makeRequest()),
      guard.readSession(makeRequest()),
    ];

    guard.acquire(sessions[0].sessionId, 1_000)();
    guard.acquire(sessions[1].sessionId, 1_001)();
    expect(() => guard.acquire(sessions[2].sessionId, 1_002)).toThrowError(
      expect.objectContaining({ status: 429 }) as AiRequestGuardError,
    );
  });

  it("expires inactive issued sessions and reissues an opaque id", () => {
    const guard = new AiRequestGuard({ sessionTtlMs: 1_000 });
    const issued = guard.establishSession(guard.readSession(makeRequest(), 1_000), 1_000);

    const expired = guard.readSession(makeRequest(issued.cookieValue), 2_001);

    expect(expired.shouldSetCookie).toBe(false);
    expect(expired.cookieValue).toBeUndefined();
    expect(expired.sessionId).not.toBe(issued.cookieValue);
  });

  it("evicts the oldest inactive issued session when the table reaches its cap", () => {
    const guard = new AiRequestGuard({
      maxTrackedSessions: 100,
      sessionTtlMs: 60_000,
    });
    const oldest = guard.establishSession(guard.readSession(makeRequest(), 1_000), 1_000);
    for (let index = 1; index <= 100; index += 1) {
      guard.establishSession(
        guard.readSession(makeRequest(), 1_000 + index),
        1_000 + index,
      );
    }

    const afterEviction = guard.readSession(
      makeRequest(oldest.cookieValue),
      2_000,
    );

    expect(afterEviction.shouldSetCookie).toBe(false);
    expect(afterEviction.cookieValue).toBeUndefined();
  });
});

function makeRequest(sessionId?: string): Request {
  return new Request("http://localhost/api/ai", {
    headers: sessionId ? { Cookie: `ai_session=${sessionId}` } : undefined,
  });
}
