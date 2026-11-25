import { AppError } from '../lib/AppError.js';

/**
 * Request validation middleware built on Zod.
 *
 *   router.post('/x', validate(schema, 'body'), handler)
 *   router.get('/y', validate(querySchema, 'query'), handler)
 *
 * Validated data replaces req[source] so downstream handlers always see a
 * normalised, typed value. On failure it responds 400 with the flattened
 * details (no stack traces are ever exposed).
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        AppError.badRequest('Invalid input', {
          issues: result.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        })
      );
    }
    req[source] = result.data;
    return next();
  };
}
