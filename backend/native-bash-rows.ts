import {
  BashExecutionComponent,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  callComponentMethod,
  componentField,
  type PiComponent,
} from "./component-runtime.ts";
import type { DesktopTui } from "./tui-api.ts";

type Result = Awaited<ReturnType<AgentSession["executeBash"]>>;
type Message = Extract<
  AgentSession["messages"][number],
  { role: "bashExecution" }
>;
export interface NativeBashExecution {
  id: string;
  component: BashExecutionComponent;
  pending: boolean;
  adopted: boolean;
  result?: Result;
  command: string;
  exclude: boolean;
}
/** Original live bash objects survive recording and deferred transcript insertion. */
export class NativeBashRows {
  private executions: NativeBashExecution[] = [];
  private recorded: NativeBashExecution[] = [];
  private sequence = 0;
  private retired = false;
  constructor(
    private tui: DesktopTui,
    private changed: () => void,
  ) {}
  begin(command: string, exclude: boolean, pending: boolean) {
    const execution: NativeBashExecution = {
      id: `native-bash:${++this.sequence}`,
      command,
      exclude,
      pending,
      adopted: false,
      component: new BashExecutionComponent(command, this.tui, exclude),
    };
    this.executions.push(execution);
    this.changed();
    return execution;
  }
  append(execution: NativeBashExecution, chunk: string) {
    if (this.retired) return;
    execution.component.appendOutput(chunk);
    this.changed();
  }
  record(execution: NativeBashExecution, result: Result) {
    if (this.retired) return;
    execution.result = result;
    if (!this.recorded.includes(execution)) this.recorded.push(execution);
    execution.component.setComplete(
      result.exitCode,
      result.cancelled,
      result.truncated
        ? ({ truncated: true, content: result.output } as Parameters<
            BashExecutionComponent["setComplete"]
          >[2])
        : undefined,
      result.fullOutputPath,
    );
    this.changed();
  }
  complete(execution: NativeBashExecution, result?: Result) {
    if (this.retired) return;
    if (result) {
      if (!execution.result) this.record(execution, result);
    } else execution.component.setComplete(undefined, false);
    this.changed();
  }
  adopt(message: Message) {
    const execution = this.recorded.find(
      (entry) =>
        !entry.adopted &&
        entry.command === message.command &&
        entry.exclude === (message.excludeFromContext === true) &&
        entry.result?.output === message.output &&
        entry.result.exitCode === message.exitCode &&
        entry.result.cancelled === message.cancelled &&
        entry.result.truncated === message.truncated &&
        entry.result.fullOutputPath === message.fullOutputPath,
    );
    if (!execution) return;
    execution.adopted = true;
    return execution.component;
  }
  entries(pending: boolean): { id: string; component: PiComponent }[] {
    return this.executions
      .filter((entry) => !entry.adopted && entry.pending === pending)
      .map(({ id, component }) => ({ id, component }));
  }
  setExpanded(expanded: boolean) {
    for (const entry of this.executions)
      if (!entry.adopted) entry.component.setExpanded(expanded);
  }
  invalidate() {
    for (const entry of this.executions)
      if (!entry.adopted) entry.component.invalidate();
  }
  dispose() {
    if (this.retired) return;
    this.retired = true;
    for (const entry of this.executions)
      callComponentMethod(
        componentField(entry.component, "loader") as PiComponent,
        "stop",
      );
    this.executions = [];
    this.recorded = [];
  }
}
