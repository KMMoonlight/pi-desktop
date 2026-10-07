import test from "node:test";
import assert from "node:assert/strict";
import {
  delegatedComponent,
  delegatedRender,
} from "../backend/component-delegation.ts";

test("delegation retains render replacements made by the original component", () => {
  for (const own of [false, true]) {
    for (const failure of [false, true]) {
      const replacement = (_width: number) => ["replacement"];
      class Child {
        render(_width: number) {
          this.render = replacement;
          return ["initial"];
        }
        invalidate() {}
      }
      const child = new Child();
      if (own)
        Object.defineProperty(child, "render", {
          value: child.render,
          configurable: true,
          writable: true,
          enumerable: true,
        });
      const wrapper = {
        child,
        render(width: number) {
          const lines = child.render(width);
          if (failure) throw new Error("original failure");
          return lines;
        },
        invalidate() {},
      };
      if (failure)
        assert.throws(
          () => delegatedComponent(wrapper, 80, {}),
          /original failure/,
        );
      else assert.equal(delegatedComponent(wrapper, 80, {}), child);
      assert.equal(child.render, replacement);
      assert.deepEqual(child.render(80), ["replacement"]);
    }
  }
});

test("delegation requires exactly one unchanged child render and restores descriptors", () => {
  const child = { render: (_width: number) => ["child"], invalidate() {} };
  const descriptor = Object.getOwnPropertyDescriptor(child, "render");
  const wrapper = {
    child,
    render(width: number) {
      return this.child.render(width);
    },
    invalidate() {},
  };
  assert.equal(delegatedComponent(wrapper, 80, {}), child);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(child, "render"),
    descriptor,
  );
  assert.equal(
    delegatedComponent(
      {
        ...wrapper,
        render(width: number) {
          return [...child.render(width), "extra drawing"];
        },
      },
      80,
      {},
    ),
    undefined,
  );
  assert.equal(
    delegatedComponent(
      {
        ...wrapper,
        render(width: number) {
          child.render(width);
          return child.render(width);
        },
      },
      80,
      {},
    ),
    undefined,
  );
  assert.equal(
    delegatedComponent(
      {
        ...wrapper,
        render(width: number) {
          return child.render(width - 2);
        },
      },
      80,
      {},
    ),
    undefined,
  );
  assert.throws(
    () =>
      delegatedComponent(
        {
          ...wrapper,
          render(width: number) {
            child.render(width);
            throw new Error("original failure");
          },
        },
        80,
        {},
      ),
    /original failure/,
  );
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(child, "render"),
    descriptor,
  );
});

test("delegation skips inaccessible members and frozen children", () => {
  const child = Object.freeze({
    render: (_width: number) => ["child"],
    invalidate() {},
  });
  const wrapper = {
    child,
    get dangerous() {
      throw new Error("getter must not run");
    },
    render(width: number) {
      return child.render(width);
    },
    invalidate() {},
  };
  assert.equal(delegatedComponent(wrapper, 80, {}), undefined);
});

test("delegated observation retains the frame before in-place wrapper changes", () => {
  let renders = 0;
  const child = { render: (_width: number) => ["original"], invalidate() {} };
  const descriptor = Object.getOwnPropertyDescriptor(child, "render");
  const wrapper = {
    child,
    render(width: number) {
      renders++;
      const lines = this.child.render(width);
      lines[0] = "transformed";
      lines.unshift("heading");
      return lines;
    },
    invalidate() {},
  };
  const frame = delegatedRender(wrapper, 80, {});
  assert.equal(frame.child?.component, child);
  assert.deepEqual(frame.child?.lines, ["original"]);
  assert.deepEqual(frame.lines, ["heading", "transformed"]);
  assert.equal(renders, 1);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(child, "render"),
    descriptor,
  );
});

test("ambiguous and frozen delegation retains one observed original terminal frame", () => {
  for (const mode of ["multiple", "width", "frozen", "none"]) {
    let renders = 0;
    const child = {
      render: (width: number) => [`child ${width}`],
      invalidate() {},
    };
    if (mode === "frozen") Object.freeze(child);
    const wrapper = {
      ...(mode === "none" ? {} : { child }),
      render(width: number) {
        renders++;
        const result = child.render(mode === "width" ? width - 1 : width);
        return mode === "multiple"
          ? result.concat(child.render(width))
          : result;
      },
      invalidate() {},
    };
    const frame = delegatedRender(wrapper, 80, {});
    assert.equal(frame.child, undefined);
    assert.deepEqual(
      frame.lines,
      mode === "multiple"
        ? ["child 80", "child 80"]
        : [`child ${mode === "width" ? 79 : 80}`],
    );
    assert.equal(renders, 1);
  }
});

test("delegation observes children held through symbols and cyclic data collections", () => {
  for (const storage of [
    "symbol",
    "array",
    "map-value",
    "map-key",
    "set",
    "record",
  ]) {
    const child = { render: (_width: number) => ["child"], invalidate() {} };
    const descriptor = Object.getOwnPropertyDescriptor(child, "render");
    const holders: Record<string, object> = {
      symbol: { [Symbol("body")]: child },
      array: { body: [child, child] },
      "map-value": { body: new Map([["field", child]]) },
      "map-key": { body: new Map([[child, "field"]]) },
      set: { body: new Set([child]) },
      record: { body: { content: { field: child } } },
    };
    const holder = holders[storage];
    Reflect.set(holder, "self", holder);
    Object.defineProperty(holder, "dangerous", {
      get() {
        throw new Error("holder getter must not run");
      },
    });
    Reflect.set(holder, "decoy", {
      get render() {
        throw new Error("render getter must not run");
      },
    });
    const wrapper = {
      ...holder,
      render(width: number) {
        return ["heading", ...child.render(width)];
      },
      invalidate() {},
    };
    const frame = delegatedRender(wrapper, 80, {});
    assert.equal(frame.child?.component, child, storage);
    assert.deepEqual(frame.children, [child], storage);
    assert.deepEqual(frame.lines, ["heading", "child"]);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(child, "render"),
      descriptor,
    );
  }
});

test("delegation leaves nonconfigurable renders on the original fallback without changing their attributes", () => {
  const child = { render: (_width: number) => ["child"], invalidate() {} };
  Object.defineProperty(child, "render", { configurable: false });
  const descriptor = Object.getOwnPropertyDescriptor(child, "render");
  const wrapper = {
    child,
    render(width: number) {
      return this.child.render(width);
    },
    invalidate() {},
  };
  const frame = delegatedRender(wrapper, 80, {});
  assert.equal(frame.child, undefined);
  assert.deepEqual(frame.lines, ["child"]);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(child, "render"),
    descriptor,
  );
});
