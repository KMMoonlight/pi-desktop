import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { createMcpHttpFixture } from "./mcp-http-fixture.ts";

/** Disposable OAuth authorization server plus protected MCP resource; all tokens are test values. */
export async function createMcpOAuthFixture(
  options: {
    stableTokens?: boolean;
    beforeTokenResponse?: () => Promise<void>;
  } = {},
) {
  const peer = await createMcpHttpFixture();
  const grants: Record<string, string>[] = [];
  const authorizations: URL[] = [];
  const resourceTokens: (string | undefined)[] = [];
  let origin = "";
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let sequence = 0;
  let client: Record<string, unknown> | undefined;
  const codes = new Map<string, URL>();
  const json = (response: ServerResponse, status: number, value: unknown) =>
    response
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify(value));
  const body = async (request: IncomingMessage) => {
    let result = "";
    for await (const chunk of request) result += chunk;
    return result;
  };
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url!, origin);
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      json(response, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["tools"],
      });
    } else if (url.pathname === "/.well-known/oauth-authorization-server") {
      json(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["tools"],
      });
    } else if (url.pathname === "/register") {
      client = {
        ...JSON.parse(await body(request)),
        client_id: "desktop-fixture-client",
      };
      json(response, 201, client);
    } else if (url.pathname === "/authorize") {
      authorizations.push(url);
      if (
        url.searchParams.get("client_id") !== client?.client_id ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !url.searchParams.get("state")
      ) {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      const code = `fixture-code-${authorizations.length}`;
      codes.set(code, url);
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state")!);
      redirect.searchParams.set("iss", origin);
      response.writeHead(302, { Location: redirect.href }).end();
    } else if (url.pathname === "/token") {
      const grant = Object.fromEntries(
        new URLSearchParams(await body(request)),
      );
      grants.push(grant);
      let valid = grant.client_id === client?.client_id;
      if (grant.grant_type === "authorization_code") {
        const auth = codes.get(grant.code);
        codes.delete(grant.code);
        valid &&=
          !!auth &&
          grant.redirect_uri === auth.searchParams.get("redirect_uri") &&
          createHash("sha256")
            .update(grant.code_verifier ?? "")
            .digest("base64url") === auth.searchParams.get("code_challenge");
      } else if (grant.grant_type === "refresh_token")
        valid &&= grant.refresh_token === refreshToken;
      else valid = false;
      if (!valid) {
        json(response, 400, { error: "invalid_grant" });
        return;
      }
      await options.beforeTokenResponse?.();
      sequence++;
      accessToken = options.stableTokens
        ? "fixture-stable-access"
        : `fixture-access-${sequence}`;
      refreshToken = options.stableTokens
        ? undefined
        : `fixture-refresh-${sequence}`;
      json(response, 200, {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: options.stableTokens ? undefined : 3600,
        scope: "tools",
      });
    } else if (url.pathname === "/mcp") {
      resourceTokens.push(request.headers.authorization);
      if (
        !accessToken ||
        request.headers.authorization !== `Bearer ${accessToken}`
      ) {
        response
          .writeHead(401, {
            "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="tools"`,
          })
          .end();
        return;
      }
      const upstream = await fetch(peer.config.url, {
        method: request.method,
        headers: {
          Authorization: peer.config.headers.Authorization,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        ...(request.method === "POST" ? { body: await body(request) } : {}),
      });
      response
        .writeHead(upstream.status, {
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/json",
        })
        .end(Buffer.from(await upstream.arrayBuffer()));
    } else json(response, 404, { error: "not_found" });
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch((error) =>
      json(response, 500, { error: String(error) }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("OAuth fixture did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    grants,
    authorizations,
    resourceTokens,
    get issuedTokenCount() {
      return sequence;
    },
    requests: peer.requests,
    config: { url: `${origin}/mcp`, exposure: "direct", timeout: 5 },
    rejectCurrentAccessToken() {
      accessToken = undefined;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await peer.close();
    },
  };
}
