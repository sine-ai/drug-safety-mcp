/**
 * ✏️ TOOLS - Tool Definitions
 * 
 * ADD YOUR TOOLS HERE!
 * 
 * This file contains the schema definitions for your MCP tools.
 * Each tool needs:
 *   - name: Unique identifier (snake_case recommended)
 *   - description: What the tool does (be descriptive for AI)
 *   - inputSchema: JSON Schema for parameters
 * 
 * Example: Ask Cursor AI to add tools by saying:
 *   "Add a tool to search Jira issues by project and status"
 *   "Add a tool to get weather for a city"
 */

import type { ToolDefinition } from "@sineai/mcp-core";

export const TOOLS: ToolDefinition[] = [
  // -------------------------------------------------------------------------
  // EXAMPLE TOOL - Replace with your own!
  // -------------------------------------------------------------------------
  {
    name: "hello",
    description: "A simple hello world tool to verify the MCP is working. Returns a greeting message.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name to greet (optional, defaults to 'World')",
        },
      },
      required: [],
    },
  },
  
  // -------------------------------------------------------------------------
  // ADD YOUR TOOLS BELOW
  // -------------------------------------------------------------------------
  // {
  //   name: "your_tool_name",
  //   description: "Description of what your tool does",
  //   inputSchema: {
  //     type: "object" as const,
  //     properties: {
  //       param1: { type: "string", description: "First parameter" },
  //       param2: { type: "number", description: "Second parameter" },
  //     },
  //     required: ["param1"],
  //   },
  // },
];
