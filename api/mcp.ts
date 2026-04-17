// ============================================================================
// scalings.xyz MCP — Vercel Serverless Function Entry Point
// ============================================================================
//
// Exposes the MCP server over Streamable HTTP at /mcp. Stateless: no session
// tracking, no Redis, no persistence. Each request creates a fresh McpServer +
// transport pair so warm-container state never leaks between invocations.
//
// Framework-free: uses @modelcontextprotocol/sdk directly with Node's raw
// IncomingMessage/ServerResponse. The Vercel rewrite in vercel.json maps
// /mcp (on any attached host) to this function.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools, SERVER_NAME, SERVER_VERSION } from '../mcp/server.js';

export const config = {
  maxDuration: 30,
};

type VercelRequest = IncomingMessage & { body?: unknown };

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  setCorsHeaders(res);
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
  );
}

export default async function handler(
  req: VercelRequest,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    setCorsHeaders(res);
    res.end();
    return;
  }

  // Stateless mode: no GET (SSE stream) or DELETE (session close) semantics.
  if (req.method === 'GET' || req.method === 'DELETE') {
    res.setHeader('Allow', 'POST, OPTIONS');
    writeJsonRpcError(
      res,
      405,
      -32000,
      'Method not allowed. This MCP endpoint is stateless and only accepts POST.',
    );
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    writeJsonRpcError(res, 405, -32000, 'Method not allowed.');
    return;
  }

  // Per-request server + transport. Stateless: no sessionIdGenerator.
  // enableJsonResponse: serverless returns a single JSON body, not an SSE stream.
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const cleanup = (): void => {
    void transport.close();
    void server.close();
  };
  res.on('close', cleanup);

  setCorsHeaders(res);

  try {
    await server.connect(transport);
    // Vercel's Node runtime pre-parses JSON bodies into req.body. Pass it
    // through so the transport doesn't try to re-read the consumed stream.
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request error:', err);
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}
