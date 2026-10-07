import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  NativeBashRows,
  NativeBashExecution,
} from "./native-bash-rows.ts";

/** Observe this session instance's complete public bash API, preserving SDK results and options. */
export function bindSessionBash(
  session: AgentSession,
  rows: () => NativeBashRows | undefined,
  current: () => boolean,
  failed: (error: unknown) => void,
) {
  const originalExecute = session.executeBash,
    originalRecord = session.recordBashResult;
  const executeDescriptor = Object.getOwnPropertyDescriptor(
    session,
    "executeBash",
  );
  const recordDescriptor = Object.getOwnPropertyDescriptor(
    session,
    "recordBashResult",
  );
  const owner = new AsyncLocalStorage<{
    rows?: NativeBashRows;
    execution?: NativeBashExecution;
  }>();
  let active = true;
  const execute: AgentSession["executeBash"] = function (
    this: AgentSession,
    command,
    onChunk,
    options,
  ) {
    if (this !== session || !active || !current())
      return originalExecute.call(this, command, onChunk, options);
    const application = rows();
    const execution = application?.begin(
      command,
      options?.excludeFromContext === true,
      session.isStreaming,
    );
    return owner.run({ rows: application, execution }, async () => {
      try {
        const result = await originalExecute.call(
          this,
          command,
          (chunk) => {
            if (execution) application!.append(execution, chunk);
            onChunk?.(chunk);
          },
          options,
        );
        if (execution) application!.complete(execution, result);
        return result;
      } catch (error) {
        if (execution) application!.complete(execution);
        if (active && current()) failed(error);
        throw error;
      }
    });
  };
  const record: AgentSession["recordBashResult"] = function (
    this: AgentSession,
    command,
    result,
    options,
  ) {
    if (this !== session || !active || !current())
      return originalRecord.call(this, command, result, options);
    const scoped = owner.getStore();
    const application = scoped?.rows ?? rows();
    const execution =
      scoped?.execution ??
      application?.begin(
        command,
        options?.excludeFromContext === true,
        session.isStreaming,
      );
    const value = originalRecord.call(this, command, result, options);
    if (execution) {
      if (!scoped?.execution && result.output)
        application!.append(execution, result.output);
      application!.record(execution, result);
    }
    return value;
  };
  Object.defineProperty(session, "executeBash", {
    configurable: true,
    writable: true,
    enumerable: executeDescriptor?.enumerable ?? false,
    value: execute,
  });
  Object.defineProperty(session, "recordBashResult", {
    configurable: true,
    writable: true,
    enumerable: recordDescriptor?.enumerable ?? false,
    value: record,
  });
  return () => {
    active = false;
    for (const [name, callback, descriptor] of [
      ["executeBash", execute, executeDescriptor],
      ["recordBashResult", record, recordDescriptor],
    ] as const) {
      if (Object.getOwnPropertyDescriptor(session, name)?.value !== callback)
        continue;
      if (descriptor) Object.defineProperty(session, name, descriptor);
      else Reflect.deleteProperty(session, name);
    }
  };
}
