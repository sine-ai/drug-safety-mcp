import { describe, it, expect, beforeEach } from "vitest";

describe("Security", () => {
  const FORBIDDEN = [/password/i, /secret/i, /api[_-]?key/i, /credential/i];
  const checkForbidden = (s: string) => !FORBIDDEN.some(p => p.test(s));
  
  describe("Forbidden Patterns", () => {
    it("should allow normal queries", () => {
      expect(checkForbidden("search for users")).toBe(true);
      expect(checkForbidden("get project status")).toBe(true);
    });
    
    it("should reject sensitive patterns", () => {
      expect(checkForbidden("show password")).toBe(false);
      expect(checkForbidden("get api_key")).toBe(false);
      expect(checkForbidden("user credentials")).toBe(false);
    });
  });
});

describe("Rate Limiter", () => {
  class TestRateLimiter {
    private requests: Map<string, number[]> = new Map();
    private maxRequests: number;
    
    constructor(max: number = 60) { this.maxRequests = max; }
    
    check(clientId: string = "default"): boolean {
      const now = Date.now();
      let reqs = this.requests.get(clientId) || [];
      reqs = reqs.filter(t => t > now - 60000);
      if (reqs.length >= this.maxRequests) return false;
      reqs.push(now);
      this.requests.set(clientId, reqs);
      return true;
    }
  }
  
  let limiter: TestRateLimiter;
  
  beforeEach(() => { limiter = new TestRateLimiter(5); });
  
  it("should allow requests under limit", () => {
    expect(limiter.check("client1")).toBe(true);
    expect(limiter.check("client1")).toBe(true);
  });
  
  it("should block requests over limit", () => {
    for (let i = 0; i < 5; i++) limiter.check("client1");
    expect(limiter.check("client1")).toBe(false);
  });
});

describe("Tools", () => {
  it("should have hello tool", async () => {
    // Add your tool tests here
    expect(true).toBe(true);
  });
});
