import { createServer } from "node:http";

/** A local, stateless Streamable HTTP MCP peer; no credentials or external service required. */
export async function createMcpHttpFixture(
  options: { token?: string; logMessage?: string } = {},
) {
  const token = options.token ?? "desktop-mcp-fixture";
  const requests: {
    method: string;
    params: Record<string, any>;
    authorization?: string;
  }[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    requests.push({
      method: rpc.method,
      params: rpc.params ?? {},
      authorization: request.headers.authorization,
    });
    if (rpc.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    let result: unknown;
    switch (rpc.method) {
      case "initialize":
        result = {
          protocolVersion: rpc.params.protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "desktop-http-fixture", version: "1.0" },
          instructions: "A disposable desktop MCP peer",
        };
        break;
      case "tools/list":
        result = {
          tools: [
            {
              name: "echo",
              description: "Echo a desktop value",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
              outputSchema: {
                type: "object",
                properties: { echoed: { type: "string" } },
                required: ["echoed"],
              },
            },
          ],
        };
        break;
      case "tools/call":
        result = {
          content: [{ type: "text", text: `MCP:${rpc.params.arguments.text}` }],
          structuredContent: { echoed: rpc.params.arguments.text },
        };
        break;
      case "resources/list":
        result = {
          resources: [
            {
              uri: "fixture://note",
              name: "Fixture note",
              mimeType: "text/plain",
            },
          ],
        };
        break;
      case "resources/templates/list":
        result = {
          resourceTemplates: [
            {
              uriTemplate: "fixture://note/{id}",
              name: "Fixture note by id",
              mimeType: "text/plain",
            },
          ],
        };
        break;
      case "resources/read":
        result = {
          contents: [
            {
              uri: rpc.params.uri,
              mimeType: "text/plain",
              text: "Remote MCP resource content",
            },
          ],
        };
        break;
      case "ping":
        result = {};
        break;
      default:
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "Method not found" },
          }),
        );
        return;
    }
    if (rpc.method === "tools/call" && options.logMessage) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: options.logMessage } })}\n\n`,
      );
      response.end(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result })}\n\n`,
      );
      return;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("MCP fixture did not bind");
  return {
    requests,
    config: {
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
      exposure: "direct",
      timeout: 5,
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
