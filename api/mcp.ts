// ============================================================================
// scalings.xyz MCP — Vercel Serverless Function Entry Point
// ============================================================================
//
// Exposes the MCP server over Streamable HTTP at /mcp. Stateless (no Redis,
// no session IDs). The Vercel rewrite in vercel.json maps mcp.scalings.xyz/*
// to this function.

import { createMcpHandler } from 'mcp-handler';
import { registerTools, SERVER_NAME, SERVER_VERSION } from '../mcp/server.js';

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  },
  {
    // Stateless: no session tracking, no Redis. Each request is self-contained.
    sessionIdGenerator: undefined,
    // SSE is obsolete per MCP spec 2025-03-26; only serve Streamable HTTP.
    disableSse: true,
    maxDuration: 30,
    basePath: '/',
  },
);

export { handler as GET, handler as POST, handler as DELETE };
export default handler;
