#!/usr/bin/env node
/**
 * Drug Safety MCP Server
 * 
 * MCP server for FDA Adverse Event Reporting System (FAERS) data via OpenFDA API.
 * Provides pharmacovigilance tools for drug safety analysis.
 * 
 * Supports two transport modes:
 * - Local (stdio): For Claude Desktop, Cursor IDE, and other local MCP clients
 * - Remote (Streamable HTTP): For remote/cloud deployments
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

const NAME = "drug-safety-mcp";
const VERSION = "1.1.0";

/**
 * Create and configure the MCP server
 */
function createMcpServer(): Server {
  const server = new Server(
    { name: NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
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
 * Run server in local stdio mode (for Claude Desktop, Cursor, etc.)
 */
async function runLocalMode(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${NAME} v${VERSION} started (stdio mode)`);
}

/**
 * Run server in remote HTTP mode with Streamable HTTP transport
 */
async function runRemoteMode(): Promise<void> {
  const port = parseInt(process.env.PORT || "3000", 10);
  
  // Track active transports for session management
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    
    // Health check endpoint
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: NAME, version: VERSION }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      // Get or create session ID
      const sessionId = req.headers["mcp-session-id"] as string || crypto.randomUUID();
      
      let transport = transports.get(sessionId);
      
      if (!transport) {
        // Create new transport and server for this session
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        transports.set(sessionId, transport);
        
        const server = createMcpServer();
        await server.connect(transport);
        
        // Clean up on close
        transport.onclose = () => {
          transports.delete(sessionId);
        };
      }

      // Handle the request
      await transport.handleRequest(req, res);
      return;
    }

    // 404 for unknown paths
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.error(`${NAME} v${VERSION} started (HTTP mode on port ${port})`);
    console.error(`Health check: http://localhost:${port}/health`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
  });
}

/**
 * Main entry point
 */
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
