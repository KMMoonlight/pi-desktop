import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { DesktopEvent } from "../shared/types.ts";

export interface AuthorizationScope {
  signal: AbortSignal;
  cancelInput?: () => void;
  presentsUrl?: (url: string) => boolean;
  authorization?: {
    id: string;
    controller: AbortController;
    url: string;
    presented: boolean;
  };
}

/** Attach browser authorization to the original prompt or custom UI which owns it. */
export class AuthorizationScopes {
  private readonly storage = new AsyncLocalStorage<AuthorizationScope>();
  private active?: AuthorizationScope;
  private readonly pending = new Map<string, AuthorizationScope>();
  constructor(
    private readonly emit: (event: DesktopEvent) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  run<T>(
    lifetime: AbortSignal,
    operation: (scope: AuthorizationScope) => Promise<T>,
    cancelInput?: () => void,
    presentsUrl?: (url: string) => boolean,
  ): Promise<T> {
    const closed = new AbortController();
    const scope: AuthorizationScope = {
      signal: AbortSignal.any([lifetime, closed.signal]),
      cancelInput,
      presentsUrl,
    };
    const abort = () => this.cancel(scope);
    scope.signal.addEventListener("abort", abort, { once: true });
    const finish = () => {
      closed.abort();
      scope.signal.removeEventListener("abort", abort);
    };
    let result: Promise<T>;
    try {
      result = Promise.resolve(this.storage.run(scope, () => operation(scope)));
    } catch (error) {
      finish();
      return Promise.reject(error);
    }
    // End scope ownership before callers observe the original UI Promise.
    void result.then(finish, finish);
    return result;
  }

  get signal(): AbortSignal | undefined {
    const scope = this.storage.getStore();
    return scope?.authorization
      ? AbortSignal.any([scope.signal, scope.authorization.controller.signal])
      : scope?.signal;
  }

  open(url: string) {
    const scope = this.storage.getStore();
    if (!scope) {
      this.emit({ type: "auth_url", url });
      return;
    }
    if (scope.signal.aborted) return;
    this.cancel(scope);
    scope.authorization = {
      id: randomUUID(),
      controller: new AbortController(),
      url,
      presented: false,
    };
    this.active = scope;
    const authorization = scope.authorization;
    this.pending.set(authorization.id, scope);
    // Let the original caller install its redirect input before observers can
    // synchronously cancel in response to the URL notification.
    queueMicrotask(() => {
      if (scope.signal.aborted || scope.authorization !== authorization) return;
      authorization.presented = scope.presentsUrl?.(url) ?? false;
      this.emit({ type: "auth_url", url, id: authorization.id });
    });
  }

  /** A mapped UI owns its browser request while it presents that request's link.
   * Removing it ends the browser interaction, not the underlying login operation.
   */
  refreshPresentations() {
    for (const scope of this.pending.values()) {
      const authorization = scope.authorization;
      if (!authorization || !scope.presentsUrl) continue;
      const visible = scope.presentsUrl(authorization.url);
      if (visible) authorization.presented = true;
      else if (authorization.presented) this.finish(scope, false);
    }
  }

  cancel(scope = this.active) {
    this.finish(scope, true);
  }

  cancelById(id: string) {
    this.finish(this.pending.get(id), true);
  }

  /** Capture ownership before an asynchronous operation such as credential persistence. */
  completion(): () => void {
    const scope = this.storage.getStore();
    const authorization = scope?.authorization;
    return () => {
      if (authorization && scope?.authorization === authorization)
        this.finish(scope, false);
    };
  }

  private finish(scope: AuthorizationScope | undefined, cancelInput: boolean) {
    const authorization = scope?.authorization;
    if (!scope || !authorization) return;
    this.pending.delete(authorization.id);
    scope.authorization = undefined;
    if (this.active === scope) this.active = undefined;
    try {
      authorization.controller.abort();
      if (cancelInput) scope.cancelInput?.();
    } catch (error) {
      this.onError(error);
    } finally {
      this.emit({
        type: "activity",
        name: "auth_complete",
        data: { id: authorization.id },
      });
    }
  }
}
