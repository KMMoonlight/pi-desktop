export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "installed" | "latest" | "error";
export interface PendingUpdate {
  version: string;
  body?: string;
  download: (progress: (event: { event: "Started"; data: { contentLength?: number } } | { event: "Progress"; data: { chunkLength: number } } | { event: "Finished" }) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}
export interface UpdateState {
  phase: UpdatePhase;
  version?: string;
  notes?: string;
  downloaded: number;
  total?: number;
  error?: string;
  checkedAt?: number;
}

/** One owner retains the native update resource across settings closes and retries. */
export class UpdateController {
  private state: UpdateState = { phase: "idle", downloaded: 0 };
  private listeners = new Set<() => void>();
  private update?: PendingUpdate;
  private busy = false;
  constructor(private driver: {
    check: () => Promise<PendingUpdate | null>;
    restart: () => Promise<void>;
    autoDownload: () => boolean;
  }) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private fail(error: unknown, phase: UpdatePhase = "error") {
    this.set({ phase, error: String(error) });
  }
  check = async () => {
    if (this.busy || ["ready", "installed"].includes(this.state.phase)) return;
    this.busy = true;
    this.set({ phase: "checking", error: undefined, downloaded: 0, total: undefined });
    try {
      await this.update?.close();
      this.update = undefined;
      const update = await this.driver.check();
      this.update = update ?? undefined;
      this.set({ phase: update ? "available" : "latest", version: update?.version, notes: update?.body, checkedAt: Date.now() });
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
    if (this.state.phase === "available" && this.driver.autoDownload()) await this.download();
  };
  download = async () => {
    if (this.busy || !this.update || this.state.phase !== "available") return;
    this.busy = true;
    this.set({ phase: "downloading", downloaded: 0, total: undefined, error: undefined });
    try {
      await this.update.download(event => {
        if (event.event === "Started") this.set({ downloaded: 0, total: event.data.contentLength });
        if (event.event === "Progress") this.set({ downloaded: this.state.downloaded + event.data.chunkLength });
      });
      // Finished is a transport event; the promise also verifies the signature.
      this.set({ phase: "ready" });
    } catch (error) { this.fail(error, "available"); }
    finally { this.busy = false; }
  };
  install = async () => {
    if (this.busy || !this.update || !["ready", "installed"].includes(this.state.phase)) return;
    this.busy = true;
    this.set({ error: undefined });
    try {
      if (this.state.phase !== "installed") {
        this.set({ phase: "installing" });
        await this.update.install();
        this.set({ phase: "installed" });
      }
      await this.driver.restart();
    } catch (error) { this.fail(error, this.state.phase === "installed" ? "installed" : "ready"); }
    finally { this.busy = false; }
  };
}
