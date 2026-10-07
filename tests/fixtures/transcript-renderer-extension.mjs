import { CustomMessageComponent } from "@earendil-works/pi-coding-agent";
import { Box, Container, Input, Text } from "@earendil-works/pi-tui";

export default function (pi) {
  let mode = "custom",
    nextReceiver = 0,
    nextComponent = 0;
  const receivers = new WeakMap(),
    observations = new Map(),
    components = [];
  const observe = (owner, value, options, kind) => {
    if (!receivers.has(owner)) receivers.set(owner, ++nextReceiver);
    const key = kind === "message" ? value.customType : value.customType;
    observations.set(key, {
      receiverId: receivers.get(owner),
      className: owner.constructor.name,
      native:
        kind === "message"
          ? owner instanceof CustomMessageComponent
          : owner.constructor.name === "CustomEntryComponent",
      rawIdentity: owner[kind] === value,
      options: { ...options },
      optionKeys: Object.keys(options).sort(),
    });
  };
  pi.registerMessageRenderer(
    "receiver-message",
    function (message, options, theme) {
      observe(this, message, options, "message");
      if (mode === "empty") return undefined;
      if (mode === "error") throw new Error("Reactive message failure");
      if (!this.fixtureComponent || this.fixtureComponent.disposed) {
        const record = {
          id: ++nextComponent,
          type: message.customType,
          disposed: 0,
        };
        components.push(record);
        const container = new Container(),
          box = new Box(1, 1);
        const label = new Text("", 0, 0),
          input = new Input({ prompt: "Message renderer input" });
        input.setValue("Original message input");
        input.onSubmit = (value) => (record.submitted = value);
        box.addChild(label);
        box.addChild(input);
        container.addChild(box);
        container.dispose = () => {
          record.disposed++;
          container.disposed = true;
        };
        this.fixtureComponent = container;
        this.fixtureLabel = label;
      }
      this.fixtureLabel.setText(
        theme.fg(
          "success",
          `Message renderer; expanded=${options.expanded}; pad=${options.outputPad}; ${message.details?.label ?? "initial"}`,
        ),
      );
      return this.fixtureComponent;
    },
  );
  pi.registerMessageRenderer("undefined-message", function (message, options) {
    observe(this, message, options, "message");
    return undefined;
  });
  pi.registerMessageRenderer("throwing-message", function (message, options) {
    observe(this, message, options, "message");
    throw new Error("Message fixture failure");
  });
  pi.registerMessageRenderer("collision-message", function (message, options) {
    observe(this, message, options, "message");
    return new Text(message.details.label, 0, 0);
  });
  pi.registerEntryRenderer("receiver-entry", function (entry, options, theme) {
    observe(this, entry, options, "entry");
    if (mode === "empty") return undefined;
    if (mode === "error") throw new Error("Reactive entry failure");
    const result = this.fixtureText ?? new Text("", 0, 0);
    result.setText(
      theme.fg(
        "success",
        `Entry renderer; expanded=${options.expanded}; ${entry.data.label}`,
      ),
    );
    this.fixtureText = result;
    return result;
  });
  pi.registerEntryRenderer("undefined-entry", function (entry, options) {
    observe(this, entry, options, "entry");
    return undefined;
  });
  pi.registerEntryRenderer("throwing-entry", function (entry, options) {
    observe(this, entry, options, "entry");
    throw new Error("Entry fixture failure");
  });
  pi.registerCommand("transcript-renderer-mode", {
    handler(args) {
      mode = args.trim();
    },
  });
  pi.registerCommand("transcript-renderer-observe", {
    handler(args, ctx) {
      if (args.trim() === "clear") {
        ctx.ui.setStatus("transcript-renderer-observe", undefined);
        return;
      }
      ctx.ui.setStatus(
        "transcript-renderer-observe",
        JSON.stringify({
          observations: Object.fromEntries(observations),
          components,
        }),
      );
    },
  });
}
