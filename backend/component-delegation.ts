import type { PiComponent } from "./component-runtime.ts";

function dataMethod(value: object, key: string): unknown {
  const seen = new Set<object>();
  for (
    let owner: object | null = value;
    owner && !seen.has(owner);
    owner = Object.getPrototypeOf(owner)
  ) {
    seen.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return descriptor.value;
  }
}

function dataValues(value: object): unknown[] {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).map(
    (key) => Reflect.get(descriptors, key).value,
  );
}

/** Find explicit component references in data holders without executing accessors. */
export function componentReferences(
  wrapper: PiComponent,
  excluded: object,
): PiComponent[] {
  const candidates = new Set<PiComponent>();
  const seen = new Set<object>([wrapper, excluded]);
  const pending = dataValues(wrapper);
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (typeof dataMethod(value, "render") === "function") {
      candidates.add(value as PiComponent);
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (value instanceof Map) {
      Map.prototype.forEach.call(value, (entry: unknown, key: unknown) =>
        pending.push(key, entry),
      );
    } else if (value instanceof Set) {
      Set.prototype.forEach.call(value, (entry: unknown) =>
        pending.push(entry),
      );
    } else if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      continue;
    for (const entry of dataValues(value)) pending.push(entry);
  }
  return [...candidates];
}

/** Observe the original frame and its single delegated child without invoking getters. */
export function delegatedRender(
  wrapper: PiComponent,
  width: number,
  excluded: object,
  knownChildren: readonly PiComponent[] = [],
): {
  lines: string[];
  children: PiComponent[];
  child?: { component: PiComponent; lines: string[] };
} {
  const candidates = [
    ...new Set([
      ...componentReferences(wrapper, excluded),
      ...knownChildren.filter(
        (child) => typeof dataMethod(child, "render") === "function",
      ),
    ]),
  ];
  const restore: (() => void)[] = [];
  const calls: { child: PiComponent; width: number; lines: string[] }[] = [];
  let depth = 0;
  try {
    for (const child of candidates) {
      const descriptor = Object.getOwnPropertyDescriptor(child, "render");
      if (descriptor ? !descriptor.configurable : !Object.isExtensible(child))
        continue;
      const original = child.render;
      const probe = function (this: PiComponent, columns: number) {
        const outer = depth++ === 0;
        try {
          const lines = original.call(this, columns);
          if (outer) calls.push({ child, width: columns, lines: [...lines] });
          return lines;
        } finally {
          depth--;
        }
      };
      Object.defineProperty(child, "render", {
        configurable: true,
        writable: true,
        value: probe,
      });
      restore.push(() => {
        // Restore only our probe; an original callback may replace/delete the
        // method or install an accessor, including before throwing.
        if (Object.getOwnPropertyDescriptor(child, "render")?.value !== probe)
          return;
        if (descriptor) Object.defineProperty(child, "render", descriptor);
        else Reflect.deleteProperty(child, "render");
      });
    }
    const lines = wrapper.render(width);
    const call = calls[0];
    return {
      lines: [...lines],
      children: [...new Set(calls.map((call) => call.child))],
      ...(calls.length === 1 && call.width === width
        ? { child: { component: call.child, lines: call.lines } }
        : {}),
    };
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

/** Recognize an unchanged pass-through using the same original render observation. */
export function delegatedComponent(
  wrapper: PiComponent,
  width: number,
  excluded: object,
): PiComponent | undefined {
  const frame = delegatedRender(wrapper, width, excluded);
  return frame.child &&
    frame.lines.length === frame.child.lines.length &&
    frame.lines.every((line, index) => line === frame.child!.lines[index])
    ? frame.child.component
    : undefined;
}
