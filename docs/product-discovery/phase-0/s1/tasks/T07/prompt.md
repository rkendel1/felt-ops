Feature: extend `retry(fn, options)` in src/retry.js.
- `factor` (default 1): the wait before attempt n+1 is `delayMs * factor^(n-1)`.
- `onRetry(error, attempt)`: called after each failed attempt that will be retried.
- If the thrown error has `retryable === false`, stop immediately and rethrow it without retrying.
Keep the existing options and defaults working.
