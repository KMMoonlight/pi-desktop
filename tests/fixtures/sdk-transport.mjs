export default async function ({ session, emit }, { mode }) {
  switch (mode) {
    case "null":
      throw null;
    case "undefined":
      throw undefined;
    case "false":
      throw false;
    case "zero":
      throw 0;
    case "empty":
      throw "";
    case "string":
      throw "SDK string rejection";
    case "bigint-error":
      throw 42n;
    case "symbol-error":
      throw Symbol("SDK rejection");
    case "object":
      throw { reason: "SDK rejection" };
    case "unprintable":
      throw Object.create(null);
    case "error":
      throw new Error("SDK error rejection");
    case "empty-error":
      throw new Error("");
    case "bigint-result":
      return 42n;
    case "cyclic-result": {
      const value = {};
      value.self = value;
      return value;
    }
    case "json-rejection":
      return {
        toJSON() {
          throw null;
        },
      };
    case "symbol-result":
      return Symbol("SDK result");
    case "function-result":
      return () => {};
    case "void":
      return;
    case "data":
      return {
        empty: "",
        zero: 0,
        bool: false,
        nullable: null,
        nested: [1, "two"],
      };
    case "notice": {
      const ui = session.extensionRunner.getUIContext();
      ui.setHeader(() => {
        throw null;
      });
      return "notice requested";
    }
    default:
      emit("transport-ok", { mode });
      return "SDK transport alive";
  }
}
