/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error middleware instead of crashing the process (Express 4 does not await
 * async handlers on its own).
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
