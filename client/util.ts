
export function joinSignals(...signals: AbortSignal[]): AbortSignal {
  const joined = new AbortController();

  const joinedAbort = () => {
    joined.abort();

    for (const signal of signals) {
      signal.removeEventListener("abort", joinedAbort);
    }
  };

  for (const signal of signals) {
    signal.addEventListener("abort", joinedAbort);
  }

  return joined.signal;
}
