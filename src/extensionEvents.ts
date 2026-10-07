let pending = Promise.resolve();

/** Keep SDK pointer, keyboard and paste transactions in their original DOM order. */
export function enqueueExtensionEvent(
  operation: () => Promise<void>,
): Promise<void> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}
