/** Live SDK objects remain in Node; only JSON data crosses desktop transports. */
export function actionResult(value: unknown): unknown {
  if (typeof value === "function" || typeof value === "symbol")
    throw new TypeError("SDK action result must be JSON serializable");
  return value === undefined ? null : value;
}
