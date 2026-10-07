import { t, localizeText } from "./i18n";
import type { DesktopEvent, RecordValue } from "../shared/types.ts";

export class BrowserTransport {
  private token?: string;
  private authentication?: Promise<string>;

  private auth(refresh = false): Promise<string> {
    if (this.authentication) return this.authentication;
    if (!refresh && this.token) return Promise.resolve(this.token);
    const pending = (async () => {
      const response = await fetch("/api/token");
      if (!response.ok) throw new Error(t("后台连接失败"));
      const value = await response.json();
      if (typeof value.token !== "string" || !value.token)
        throw new Error(t("后台认证失败"));
      this.token = value.token;
      return value.token as string;
    })();
    this.authentication = pending;
    void pending
      .finally(() => {
        if (this.authentication === pending) this.authentication = undefined;
      })
      .catch(() => {});
    return pending;
  }

  async action<T>(name: string, args?: RecordValue): Promise<T> {
    const send = (token: string) =>
      fetch("/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-desktop-token": token,
        },
        body: JSON.stringify({ action: name, args }),
      });
    const token = await this.auth();
    let response = await send(token);
    // A 403 is rejected before the server invokes the action, so retry is safe.
    if (response.status === 403)
      response = await send(await this.auth(this.token === token));
    if (!response.ok && response.status !== 400)
      throw new Error(t("后台请求失败"));
    const result = await response.json();
    if (!response.ok || typeof result.error === "string")
      throw new Error(localizeText(result.error ?? t("后台请求失败")));
    return result.data;
  }

  subscribe(
    handler: (event: DesktopEvent) => void,
    connection: (connected: boolean, restarted: boolean) => void,
  ): () => void {
    let stopped = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previousToken: string | undefined;
    let delay = 250;
    const reconnect = () => {
      if (stopped || timer) return;
      connection(false, false);
      timer = setTimeout(() => {
        timer = undefined;
        void connect(true);
      }, delay);
      delay = Math.min(delay * 2, 5000);
    };
    const connect = async (refresh = false) => {
      try {
        const token = await this.auth(refresh);
        if (stopped) return;
        const current = new EventSource(
          `/api/events?token=${encodeURIComponent(token)}`,
        );
        source = current;
        current.onopen = () => {
          if (stopped || source !== current) return;
          const restarted =
            previousToken !== undefined && previousToken !== token;
          previousToken = token;
          delay = 250;
          connection(true, restarted);
        };
        current.onmessage = (message) => {
          if (stopped || source !== current) return;
          const event: DesktopEvent = JSON.parse(message.data);
          if (event.type === "shutdown") {
            stop();
            connection(false, false);
          }
          handler(event);
        };
        current.onerror = () => {
          if (stopped || source !== current) return;
          current.close();
          source = undefined;
          reconnect();
        };
      } catch {
        reconnect();
      }
    };
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      source = undefined;
    };
    void connect();
    return stop;
  }
}
