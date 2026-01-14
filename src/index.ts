#!/usr/bin/env node
/**
 * Drug Safety MCP Server
 * 
 * MCP server for FDA Adverse Event Reporting System (FAERS) data via OpenFDA API.
 * Provides pharmacovigilance tools for drug safety analysis.
 * 
 * Supports two transport modes:
 * - Local (stdio): For Claude Desktop, Cursor IDE, and other local MCP clients
 * - Remote (Streamable HTTP): For remote/cloud deployments with OAuth 2.0 via MCP Gateway
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, handleTool } from "./tools/index.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  loadOAuthConfig,
  validateOAuthConfig,
  authenticateRequest,
  sendUnauthorized,
  getGatewayEndpoints,
} from "./auth.js";

const NAME = "drug-safety-mcp";
const VERSION = "1.2.0";

/**
 * Create and configure the MCP server
 */
function createMcpServer(): Server {
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run server in local stdio mode
 */
async function runLocalMode(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${NAME} v${VERSION} started (stdio mode)`);
}

/**
 * Run server in remote HTTP mode with OAuth 2.0 via MCP Gateway
 */
async function runRemoteMode(): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  
  const oauthConfig = loadOAuthConfig();
  validateOAuthConfig(oauthConfig);
  
  const gatewayEndpoints = oauthConfig.enabled ? getGatewayEndpoints(oauthConfig) : null;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    
    // CORS headers
    const corsOrigin = process.env.CORS_ORIGIN || "*";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
    
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // =========================================================================
    // Health check (no auth)
    // =========================================================================
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ 
        status: "ok", 
        name: NAME, 
        version: VERSION,
        oauth_enabled: oauthConfig.enabled,
        oauth_provider: oauthConfig.enabled ? "mcp-gateway" : null,
      }));
      return;
    }
    
    // =========================================================================
    // OAuth 2.0 Discovery (RFC 8414) - Points to MCP Gateway
    // =========================================================================
    if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      if (!oauthConfig.enabled || !gatewayEndpoints) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "OAuth not enabled" }));
        return;
      }
      
      // Point clients to Gateway for OAuth
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        issuer: oauthConfig.gatewayUrl,
        authorization_endpoint: gatewayEndpoints.authorizationEndpoint,
        token_endpoint: gatewayEndpoints.tokenEndpoint,
        registration_endpoint: gatewayEndpoints.registrationEndpoint,
        scopes_supported: ["openid", "profile", "email", "mcp"],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        code_challenge_methods_supported: ["S256", "plain"],
      }));
      return;
    }
    
    // =========================================================================
    // MCP Endpoint (requires auth)
    // =========================================================================
    if (url.pathname === "/mcp") {
      const authResult = await authenticateRequest(req, res, oauthConfig);
      
      if (!authResult || !authResult.authenticated) {
        sendUnauthorized(res, authResult?.error || "Authentication required");
        return;
      }
      
      if (oauthConfig.enabled && authResult.email) {
        console.error(`[AUTH] User ${authResult.email} accessing MCP`);
      }
      
      const sessionId = req.headers["mcp-session-id"] as string || crypto.randomUUID();
      
      let transport = transports.get(sessionId);
      
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        transports.set(sessionId, transport);
        
        const server = createMcpServer();
        await server.connect(transport);
        
        transport.onclose = () => {
          transports.delete(sessionId);
        };
      }

      await transport.handleRequest(req, res);
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.error(`${NAME} v${VERSION} started (HTTP mode on port ${port})`);
    console.error(`Health: http://localhost:${port}/health`);
    console.error(`MCP: http://localhost:${port}/mcp`);
    if (oauthConfig.enabled) {
      console.error(`OAuth: ENABLED via MCP Gateway (${oauthConfig.gatewayUrl})`);
    } else {
      console.error(`OAuth: DISABLED`);
    }
  });
}

async function main(): Promise<void> {
  const mode = process.env.MCP_MODE?.toLowerCase();
  
  if (mode === "remote" || mode === "http") {
    await runRemoteMode();
  } else {
    await runLocalMode();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
