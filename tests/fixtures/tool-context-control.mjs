import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

let saved;
export default async function ({ desktop, session }, args) {
  const path = join(session.sessionManager.getCwd(), ".context-stream-release");
  if (args.action === "arm") {
    await rm(path, { force: true });
    // The shared preview's replacement footer wraps every preceding workflow
    // status. Restore Pi's default footer so that this tool's pointer target
    // has space in the transcript in a combined browser/native batch.
    session.extensionRunner.getUIContext().setFooter(undefined);
  }
  if (args.action === "release") await writeFile(path, "release");
  if (args.action === "stale") saved?.();
  if (args.action === "theme")
    session.extensionRunner.getUIContext().setTheme(args.theme);
  if (!args.id) return;
  const state = desktop.toolState(args.id);
  let synchronous;
  if (args.action === "invalidate") {
    const call = state.callContext;
    const result = state.resultContext;
    state.tick = (state.tick ?? 0) + 1;
    state[
      args.slot === "result" ? "resultContext" : "callContext"
    ]?.invalidate();
    synchronous = state.callContext !== call && state.resultContext !== result;
  }
  if (args.action === "save") saved = state.callContext?.invalidate;
  const project = (context) =>
    context && {
      args: context.args,
      argsComplete: context.argsComplete,
      executionStarted: context.executionStarted,
      isPartial: context.isPartial,
      isError: context.isError,
      showImages: context.showImages,
      expanded: context.expanded,
      sameState: context.state === state,
      reused: !!context.lastComponent,
    };
  return {
    call: project(state.callContext),
    result: project(state.resultContext),
    resultKeys: state.resultKeys,
    optionKeys: state.optionKeys,
    tick: state.tick ?? 0,
    synchronous,
    sameArguments: state.callContext?.args === state.resultContext?.args,
  };
}
