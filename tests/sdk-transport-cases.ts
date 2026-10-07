export const sdkRejectionCases = [
  ["null", "null"],
  ["undefined", "undefined"],
  ["false", "false"],
  ["zero", "0"],
  ["empty", ""],
  ["string", "SDK string rejection"],
  ["bigint-error", "42"],
  ["symbol-error", "Symbol(SDK rejection)"],
  ["object", "[object Object]"],
  ["unprintable", "Unknown error"],
  ["error", "SDK error rejection"],
  ["empty-error", ""],
] as const;

export const sdkInvalidResultCases = [
  ["bigint-result", /BigInt/i],
  ["cyclic-result", /circular/i],
  ["json-rejection", /^null$/],
  ["symbol-result", /JSON serializable/],
  ["function-result", /JSON serializable/],
] as const;
