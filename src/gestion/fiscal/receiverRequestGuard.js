// A changed/closed receiver flow must never accept an older asynchronous result.
export function createReceiverRequestGuard() {
  let version = 0;
  return {
    invalidate() { version += 1; },
    begin() { version += 1; return version; },
    isCurrent(requestVersion) { return requestVersion === version; },
  };
}
