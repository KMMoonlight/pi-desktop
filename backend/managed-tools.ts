import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import type { ManagedToolsSnapshot } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";

export type ManagedTool = "fd" | "rg";
export type ManagedToolStatus = ManagedToolsSnapshot["statuses"][number];
export type ManagedToolPaths = Record<ManagedTool, string | undefined>;
export interface ManagedToolApi {
  getToolPath(tool: ManagedTool): string | null;
  ensureTool(
    tool: ManagedTool,
    onStatus?: (status: Omit<ManagedToolStatus, "tool">) => void,
  ): Promise<string | undefined>;
}
let native: Promise<ManagedToolApi> | undefined;
export function loadManagedTools(): Promise<ManagedToolApi> {
  return (native ??= import(
    pathToFileURL(join(getPackageDir(), "dist/utils/tools-manager.js")).href
  )
    .then((module) => {
      if (
        typeof module.ensureTool !== "function" ||
        typeof module.getToolPath !== "function"
      )
        throw new Error(
          "Pi managed-tool APIs changed; a compatibility update is required",
        );
      return module as ManagedToolApi;
    })
    .catch((error) => {
      native = undefined;
      throw error;
    }));
}

/** Program-owned original Pi tool preparation. Session changes retain its paths. */
export class ManagedTools {
  private pending?: Promise<ManagedToolPaths>;
  private paths?: ManagedToolPaths;
  private state: ManagedToolsSnapshot["state"] = "idle";
  private statuses: ManagedToolStatus[] = [];
  private error?: string;
  constructor(
    private signal: AbortSignal,
    private onStatus: (status: ManagedToolStatus) => void,
    private load = loadManagedTools,
  ) {}
  snapshot(): ManagedToolsSnapshot {
    return {
      state: this.signal.aborted ? "closed" : this.state,
      paths: { fd: this.paths?.fd ?? null, rg: this.paths?.rg ?? null },
      statuses: this.statuses.map((status) => ({ ...status })),
      ...(this.error ? { error: this.error } : {}),
    };
  }
  get fdPath() {
    return this.paths?.fd;
  }
  async path(tool: ManagedTool) {
    this.signal.throwIfAborted();
    const api = await this.untilRetired(this.load());
    this.signal.throwIfAborted();
    return api.getToolPath(tool);
  }
  async prepare({ refresh = false }: { refresh?: boolean } = {}) {
    this.signal.throwIfAborted();
    if (this.paths && !refresh && !this.pending) return this.paths;
    if (!this.pending) {
      this.state = "preparing";
      this.error = undefined;
      const pending = this.load()
        .then(async (api) => {
          this.signal.throwIfAborted();
          const results = await Promise.allSettled(
            (["fd", "rg"] as const).map((tool) =>
              api.ensureTool(tool, (status) => {
                if (this.signal.aborted) return;
                const event = { tool, ...status };
                this.statuses.push({ ...event });
                this.onStatus(event);
              }),
            ),
          );
          this.signal.throwIfAborted();
          for (const result of results)
            if (result.status === "rejected") throw result.reason;
          const [fd, rg] = results.map((result) =>
            result.status === "fulfilled" ? result.value : undefined,
          );
          this.paths = { fd, rg };
          this.state = "settled";
          return this.paths;
        })
        .catch((error) => {
          if (!this.signal.aborted) {
            this.state = "failed";
            this.error = errorMessage(error);
          }
          throw error;
        })
        .finally(() => {
          if (this.pending === pending) this.pending = undefined;
        });
      this.pending = pending;
    }
    return this.untilRetired(this.pending);
  }
  private untilRetired<T>(pending: Promise<T>): Promise<T> {
    let abort!: () => void;
    const retired = new Promise<never>((_resolve, reject) => {
      abort = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
    });
    return Promise.race([pending, retired]).finally(() =>
      this.signal.removeEventListener("abort", abort),
    );
  }
}
