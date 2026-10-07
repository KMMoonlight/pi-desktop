import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { RecordValue } from "../shared/types.ts";

function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

export async function runModelOperation(
  runtime: ModelRuntime,
  args: RecordValue,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
) {
  const ref = object(args.model);
  if (typeof ref.provider !== "string" || typeof ref.id !== "string")
    throw new Error("Model provider and id are required");
  const options = { ...object(args.options), signal };
  if (args.operation === "generateImages") {
    const model = runtime.getModelOfType("image", ref.provider, ref.id);
    if (!model) throw new Error("Image model does not exist");
    return runtime.generateImages(
      model,
      args.context as Parameters<ModelRuntime["generateImages"]>[1],
      options,
    );
  }
  if (args.operation === "classify") {
    const model = runtime.getModelOfType("classifier", ref.provider, ref.id);
    if (!model) throw new Error("Classifier model does not exist");
    return runtime.classify(
      model,
      args.context as Parameters<ModelRuntime["classify"]>[1],
      options,
    );
  }
  const model = runtime.getModel(ref.provider, ref.id);
  if (!model) throw new Error("Chat model does not exist");
  const context = args.context as Parameters<ModelRuntime["completeSimple"]>[1];
  const handle = args.handle as Parameters<ModelRuntime["fetchDeferred"]>[1];
  switch (args.operation) {
    case "complete":
      return runtime.complete(model, context, options);
    case "completeSimple":
      return runtime.completeSimple(model, context, options);
    case "fetchDeferred":
      return runtime.fetchDeferred(model, handle, options);
    case "cancelDeferred":
      return runtime.cancelDeferred(model, handle, options);
    case "resolveModel":
      return runtime.resolveModel(
        model,
        args.messages as Parameters<ModelRuntime["resolveModel"]>[1],
        {
          ...object(args.options),
          reason: object(args.options).reason as Parameters<
            ModelRuntime["resolveModel"]
          >[2]["reason"],
          thinkingLevel: object(args.options).thinkingLevel as Parameters<
            ModelRuntime["resolveModel"]
          >[2]["thinkingLevel"],
          signal,
        },
      );
    case "stream":
    case "streamSimple":
    case "streamDeferred": {
      const stream =
        args.operation === "stream"
          ? runtime.stream(model, context, options)
          : args.operation === "streamSimple"
            ? runtime.streamSimple(model, context, options)
            : runtime.streamDeferred(model, handle, options);
      for await (const event of stream) onEvent(event);
      return stream.result();
    }
    default:
      throw new Error("Unknown model operation");
  }
}
