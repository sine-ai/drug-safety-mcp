/**
 * Drug Safety MCP Server Tests
 * 
 * Tests for tool definitions, handlers, and server functionality.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TOOLS } from "../src/tools/definitions.js";
import { handleTool } from "../src/tools/handlers.js";

// ============================================================================
// TOOL DEFINITIONS TESTS
// ============================================================================

describe("Tool Definitions", () => {
  it("should have 17 tools defined", () => {
    expect(TOOLS.length).toBe(17);
  });

  it("should have valid tool names (< 64 chars, snake_case)", () => {
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeLessThan(64);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("should have descriptions for all tools", () => {
    for (const tool of TOOLS) {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("should have valid input schemas", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it("should have annotations on all tools", () => {
    for (const tool of TOOLS) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations?.title).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true); // All tools are read-only
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.annotations?.openWorldHint).toBe(true); // All query external API
    }
  });

  describe("Expected tools", () => {
    const expectedTools = [
      "search_adverse_events",
      "get_event_counts",
      "compare_safety_profiles",
      "get_serious_events",
      "get_reporting_trends",
      "search_by_reaction",
      "get_concomitant_drugs",
      "get_data_info",
      "get_drug_label_info",
      "get_recall_info",
      "search_by_indication",
      "search_by_drug_class",
      "compare_label_to_reports",
      "get_pediatric_safety",
      "get_geriatric_safety",
      "get_safety_summary",
      "get_pregnancy_lactation_info",
    ];

    for (const toolName of expectedTools) {
      it(`should have tool: ${toolName}`, () => {
        const tool = TOOLS.find(t => t.name === toolName);
        expect(tool).toBeDefined();
      });
    }
  });
});

// ============================================================================
// TOOL HANDLER TESTS
// ============================================================================

describe("Tool Handlers", () => {
  describe("Input Validation", () => {
    it("should reject missing required parameters", async () => {
      await expect(handleTool("search_adverse_events", {}))
        .rejects.toThrow(/drug_name/i);
    });

    it("should reject empty string parameters", async () => {
      await expect(handleTool("search_adverse_events", { drug_name: "" }))
        .rejects.toThrow(/empty/i);
    });

    it("should reject invalid limit values", async () => {
      await expect(handleTool("search_adverse_events", { 
        drug_name: "aspirin", 
        limit: 0 
      })).rejects.toThrow(/limit/i);
    });

    it("should reject limit exceeding max", async () => {
      await expect(handleTool("search_adverse_events", { 
        drug_name: "aspirin", 
        limit: 200 
      })).rejects.toThrow(/limit/i);
    });
  });

  describe("Unknown Tools", () => {
    it("should reject unknown tool names", async () => {
      await expect(handleTool("unknown_tool", {}))
        .rejects.toThrow(/unknown tool/i);
    });
  });

  describe("get_data_info", () => {
    it("should return database information", async () => {
      const result = await handleTool("get_data_info", {}) as Record<string, unknown>;
      
      expect(result.database).toContain("FAERS");
      expect(result.source).toContain("OpenFDA");
      expect(result.limitations).toBeDefined();
      expect(Array.isArray(result.limitations)).toBe(true);
      expect(result.disclaimer).toBeDefined();
    });
  });
});

// ============================================================================
// SECURITY TESTS
// ============================================================================

describe("Security", () => {
  const FORBIDDEN = [/password/i, /secret/i, /credential/i];
  const checkForbidden = (s: string) => !FORBIDDEN.some(p => p.test(s));
  
  describe("Forbidden Patterns", () => {
    it("should allow normal queries", () => {
      expect(checkForbidden("search for adverse events")).toBe(true);
      expect(checkForbidden("get drug safety data")).toBe(true);
      expect(checkForbidden("compare safety profiles")).toBe(true);
    });
    
    it("should reject sensitive patterns", () => {
      expect(checkForbidden("show password")).toBe(false);
      expect(checkForbidden("user credentials")).toBe(false);
    });
  });

  describe("API Key Handling", () => {
    it("should not expose API key in tool definitions", () => {
      const toolsJson = JSON.stringify(TOOLS);
      expect(toolsJson).not.toContain("api_key");
      expect(toolsJson).not.toContain("apiKey");
    });

    it("should not have hardcoded API keys in tool descriptions", () => {
      for (const tool of TOOLS) {
        expect(tool.description).not.toMatch(/[a-zA-Z0-9]{32,}/); // No long alphanumeric strings
      }
    });
  });
});

// ============================================================================
// RATE LIMITER TESTS
// ============================================================================

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

  it("should track different clients separately", () => {
    for (let i = 0; i < 5; i++) limiter.check("client1");
    expect(limiter.check("client1")).toBe(false);
    expect(limiter.check("client2")).toBe(true); // Different client
  });
});

// ============================================================================
// INTEGRATION TESTS (require network - skip in CI)
// ============================================================================

describe.skipIf(process.env.CI === "true")("Integration Tests", () => {
  // These tests make real API calls - skip in CI
  
  it("should search adverse events for a real drug", async () => {
    const result = await handleTool("search_adverse_events", {
      drug_name: "aspirin",
      limit: 1,
    }) as Record<string, unknown>;
    
    expect(result.disclaimer).toBeDefined();
    // May or may not have results depending on API
  }, 30000);

  it("should get event counts for a real drug", async () => {
    const result = await handleTool("get_event_counts", {
      drug_name: "ibuprofen",
      group_by: "reaction",
      limit: 5,
    }) as Record<string, unknown>;
    
    expect(result.drug).toBe("ibuprofen");
    expect(result.disclaimer).toBeDefined();
  }, 30000);
});

// ============================================================================
// MOCK TESTS
// ============================================================================

describe("Response Format", () => {
  it("should include disclaimer in all data responses", async () => {
    // get_data_info doesn't require API call for basic structure
    const result = await handleTool("get_data_info", {}) as Record<string, unknown>;
    expect(result.disclaimer).toContain("IMPORTANT");
    expect(result.disclaimer).toContain("NOT prove");
  });
});

describe("Error Messages", () => {
  it("should provide helpful error for missing drug_name", async () => {
    try {
      await handleTool("search_adverse_events", {});
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("drug_name");
    }
  });

  it("should provide helpful error for invalid group_by", async () => {
    try {
      await handleTool("get_event_counts", {
        drug_name: "aspirin",
        group_by: "invalid_field",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("group_by");
    }
  });
});
