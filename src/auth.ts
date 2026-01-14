/**
 * OAuth 2.0 Authentication Module
 * 
 * Delegates authentication to MCP Gateway which handles Azure AD OAuth.
 * This allows any user with a Microsoft account (work/school/personal) to authenticate.
 * 
 * Flow:
 * 1. Client calls /.well-known/oauth-authorization-server to discover endpoints
 * 2. Client redirects user to Gateway's authorization endpoint
 * 3. User signs in with Microsoft via Gateway
 * 4. Gateway redirects back with authorization code
 * 5. Client exchanges code for tokens via Gateway
 * 6. Client uses access token for MCP requests
 */

import { IncomingMessage, ServerResponse } from "node:http";

// ============================================================================
// TYPES
// ============================================================================

export interface OAuthConfig {
  enabled: boolean;
  gatewayUrl: string;      // MCP Gateway URL (e.g., https://mcp-gateway.../...)
  baseUrl: string;         // This server's base URL for callbacks
}

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

// Session storage for validated tokens
const sessions = new Map<string, {
  userId: string;
  email: string;
  expiresAt: number;
}>();

// Pending OAuth flows (state -> redirect info)
const pendingAuth = new Map<string, {
  redirectUri: string;
  originalState: string;
}>();

// ============================================================================
// CONFIGURATION
// ============================================================================

export function loadOAuthConfig(): OAuthConfig {
  const enabled = process.env.OAUTH_ENABLED === "true";
  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  
  return {
    enabled,
    gatewayUrl: process.env.MCP_GATEWAY_URL || "",
    baseUrl,
  };
}

export function validateOAuthConfig(config: OAuthConfig): void {
  if (!config.enabled) return;
  
  if (!config.gatewayUrl) {
    throw new Error(
      `OAuth 2.0 is enabled but MCP_GATEWAY_URL is not set. ` +
      `Please set this environment variable or disable OAuth by removing OAUTH_ENABLED=true.`
    );
  }
}

// ============================================================================
// GATEWAY OAUTH ENDPOINTS
// ============================================================================

export function getGatewayEndpoints(config: OAuthConfig) {
  const base = config.gatewayUrl.replace(/\/$/, "");
  return {
    authorizationEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/oauth/token`,
    userinfoEndpoint: `${base}/oauth/userinfo`,
    registrationEndpoint: `${base}/oauth/register`,
  };
}

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

/**
 * Validate token by calling Gateway's userinfo endpoint
 */
export async function validateTokenWithGateway(
  token: string,
  config: OAuthConfig
): Promise<AuthResult> {
  try {
    const endpoints = getGatewayEndpoints(config);
    
    const response = await fetch(endpoints.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        return { authenticated: false, error: "Invalid or expired token. Please sign in again." };
      }
      return { authenticated: false, error: `Token validation failed: ${response.status}` };
    }
    
    const userInfo = await response.json() as { sub: string; email?: string; name?: string };
    
    return {
      authenticated: true,
      userId: userInfo.sub,
      email: userInfo.email || userInfo.name || userInfo.sub,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { authenticated: false, error: `Gateway validation failed: ${message}` };
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

export function createSession(
  sessionId: string,
  userId: string,
  email: string,
  expiresIn: number
): void {
  sessions.set(sessionId, {
    userId,
    email,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  
  // Clean up expired sessions periodically
  setTimeout(() => sessions.delete(sessionId), expiresIn * 1000);
}

export function getSession(sessionId: string): { userId: string; email: string } | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function storePendingAuth(
  state: string,
  redirectUri: string,
  originalState: string
): void {
  pendingAuth.set(state, { redirectUri, originalState });
  // Clean up after 10 minutes
  setTimeout(() => pendingAuth.delete(state), 10 * 60 * 1000);
}

export function getPendingAuth(state: string): { redirectUri: string; originalState: string } | null {
  const pending = pendingAuth.get(state);
  if (pending) {
    pendingAuth.delete(state);
  }
  return pending || null;
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

export async function authenticateRequest(
  req: IncomingMessage,
  _res: ServerResponse,
  config: OAuthConfig
): Promise<AuthResult> {
  if (!config.enabled) {
    return { authenticated: true };
  }
  
  const token = extractBearerToken(req.headers.authorization);
  
  if (!token) {
    return {
      authenticated: false,
      error: "Missing Authorization header. Please sign in via the OAuth flow.",
    };
  }
  
  // First check local session cache
  const session = getSession(token);
  if (session) {
    return {
      authenticated: true,
      userId: session.userId,
      email: session.email,
    };
  }
  
  // Validate with Gateway
  const result = await validateTokenWithGateway(token, config);
  
  // Cache successful validations
  if (result.authenticated && result.userId) {
    createSession(token, result.userId, result.email || result.userId, 3600);
  }
  
  return result;
}

/**
 * Sanitize error message for client response
 * Prevents leaking internal error details (CWE-200, CWE-209)
 */
function sanitizeErrorMessage(error: string): string {
  // Map of safe, user-friendly error messages
  const safeMessages: Record<string, string> = {
    "missing authorization header": "Authentication required. Please sign in.",
    "invalid token format": "Invalid authentication token. Please sign in again.",
    "invalid or expired token": "Your session has expired. Please sign in again.",
    "token validation failed": "Authentication failed. Please try again.",
    "gateway validation failed": "Authentication service unavailable. Please try again later.",
  };

  // Check if error matches a known safe message pattern
  const errorLower = error.toLowerCase();
  for (const [pattern, safeMessage] of Object.entries(safeMessages)) {
    if (errorLower.includes(pattern)) {
      return safeMessage;
    }
  }

  // Default generic message - don't expose internal details
  return "Authentication failed. Please sign in again.";
}

export function sendUnauthorized(res: ServerResponse, error: string): void {
  // Log the actual error for debugging (server-side only)
  console.error(`[AUTH] Unauthorized: ${error}`);
  
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": 'Bearer realm="drug-safety-mcp", error="invalid_token"',
  });
  res.end(JSON.stringify({
    error: "unauthorized",
    error_description: sanitizeErrorMessage(error),
  }));
}
