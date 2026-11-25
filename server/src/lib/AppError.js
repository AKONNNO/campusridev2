/**
 * AppError — an error that carries an HTTP status code so the error middleware
 * can turn it into a proper JSON response (with 4xx vs 5xx semantics).
 * `details` is optional structured information (e.g. validation failures).
 */
export class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message, details) {
    return new AppError(400, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message);
  }

  static forbidden(message = 'You are not allowed to do that') {
    return new AppError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, message);
  }

  static conflict(message) {
    return new AppError(409, message);
  }
}
