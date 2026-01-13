/**
 * ✏️ TOOLS - Tool Handlers
 * 
 * IMPLEMENT YOUR TOOLS HERE!
 * 
 * This file contains the implementation for your MCP tools.
 * Each handler receives the tool arguments and returns a result.
 * 
 * Available imports from @sineai/mcp-core:
 *   - secrets: Get secrets from Key Vault (await secrets.get("secret-name"))
 *   - validateInput: Validate user input for security
 *   - audit: Log events for security auditing
 * 
 * Example: Ask Cursor AI to implement handlers by saying:
 *   "Implement the search_jira_issues handler to call the Jira API"
 */

import { ErrorCode, McpError, validateInput, audit, secrets } from "@sineai/mcp-core";

// Note: secrets is imported but may not be used in the example handler.
// When implementing your tools, use it like: const apiKey = await secrets.get("api-key");
void secrets;

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Example: Hello World tool
 */
async function handleHello(args: { name?: string }): Promise<{ message: string }> {
  const name = args.name || "World";
  validateInput(name);
  
  audit({ level: "info", event: "hello_called", name });
  
  return {
    message: `Hello, ${name}! Your MCP server is working. 🎉`,
  };
}

// -------------------------------------------------------------------------
// ADD YOUR HANDLERS BELOW
// -------------------------------------------------------------------------

// Example template:
// async function handleYourTool(args: { param1: string; param2?: number }): Promise<unknown> {
//   // Validate input
//   validateInput(args.param1);
//   
//   // Get secrets if needed
//   const apiToken = await secrets.get("your-api-token");
//   
//   // Implement your logic
//   const result = { /* your result */ };
//   
//   // Audit log
//   audit({ level: "info", event: "your_tool_called", param1: args.param1 });
//   
//   return result;
// }

// ============================================================================
// HANDLER ROUTER
// ============================================================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "hello":
      return handleHello(args as { name?: string });
    
    // Add your tool cases here:
    // case "your_tool_name":
    //   return handleYourTool(args as { param1: string; param2?: number });
    
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
