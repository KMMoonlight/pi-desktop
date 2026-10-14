import type { DesktopHost } from "../backend/host.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}

/** Pi 1.2 uses its mapped manager input for both /mcp and /mcp login. */
export function mcpSignInInput(host: DesktopHost) {
  for (const surface of host.desktopUI.surfaces.filter(
    (surface) => surface.slot === "dialog",
  )) {
    const children = nodes(surface.view);
    if (
      !children.some(
        (node) => node.kind === "text" && node.text.includes("Sign in to"),
      )
    )
      continue;
    const input = children.find((node) => node.kind === "input");
    if (input?.kind === "input") return { surface, input };
  }
}

export async function submitMcpRedirect(host: DesktopHost, value: string) {
  const current = mcpSignInInput(host);
  if (!current) throw new Error("MCP sign-in input is unavailable");
  await host.desktopUI.action(current.surface.id, {
    action: current.input.action,
    value,
  });
  await host.desktopUI.input(current.surface.id, "\r");
}
