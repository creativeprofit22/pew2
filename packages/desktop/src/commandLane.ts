/** Keep background polls from colliding with a user action at the native lock. */
export function createCommandLane(capacity = 3) {
  let tail: Promise<void> = Promise.resolve();
  let queued = 0;
  return <T>(operation: () => Promise<T>): Promise<T> => {
    if (queued >= capacity) return Promise.reject(new Error("operation_in_progress"));
    queued++;
    const result = tail.then(operation).finally(() => { queued--; });
    tail = result.then(() => {}, () => {});
    return result;
  };
}
