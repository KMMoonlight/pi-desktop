export default async function ({ runtime, host }, { mode = "installed" }) {
  const events = [];
  const failure = new Error(`Caller ${mode} failed`);
  let disposed = 0;
  let receivers = true;
  let optionsText;
  const outgoing = runtime.session;
  const ui = outgoing.extensionRunner.getUIContext();
  ui.setEditorText("Outgoing draft");
  ui.setHeader(() => ({
    render: () => ["Outgoing callback header"],
    dispose: () => {
      disposed++;
    },
  }));
  const deadline = Date.now() + 5000;
  while (!host.desktopUI.surfaces.some(({ id }) => id === "header")) {
    if (Date.now() > deadline) throw new Error("Outgoing header did not mount");
    await new Promise((done) => setTimeout(done, 10));
  }
  runtime.setBeforeSessionInvalidate(function () {
    receivers &&= this === runtime;
    events.push("before");
    if (mode === "before-failure") throw failure;
  });
  runtime.setRebindSession(async function (session) {
    receivers &&= this === runtime;
    events.push("rebind");
    session.extensionRunner.getUIContext().setEditorText("Callback draft");
    if (mode === "rebind-failure") throw failure;
  });
  if (mode === "cleared") {
    runtime.setBeforeSessionInvalidate(undefined);
    runtime.setRebindSession(undefined);
  }
  let preserved = false;
  let result;
  try {
    result = await runtime.newSession({
      withSession: async (context) => {
        events.push("options");
        optionsText = context.ui.getEditorText();
      },
    });
  } catch (error) {
    if (!mode.endsWith("failure")) throw error;
    preserved = error === failure;
  } finally {
    runtime.setBeforeSessionInvalidate(undefined);
    runtime.setRebindSession(undefined);
  }
  if (mode.endsWith("failure")) result = await runtime.newSession();
  return {
    events,
    disposed,
    receivers,
    preserved,
    optionsText: optionsText ?? null,
    cancelled: result.cancelled,
    replaced: runtime.session !== outgoing,
    hasUI: runtime.session.extensionRunner.hasUI(),
    text: runtime.session.extensionRunner.getUIContext().getEditorText(),
    hasEditor: host.desktopUI.surfaces.some(({ slot }) => slot === "editor"),
  };
}
