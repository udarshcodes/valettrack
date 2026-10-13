export function errorHandler(err, req, res, next) {
  console.error(`[Error] ${req.method} ${req.url}:`, err);

  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'A record with this unique attribute already exists.',
      detail: err.detail
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(409).json({
      error: 'Foreign Key Violation',
      message: 'Operation cannot be completed because related records exist or reference is invalid.',
      detail: err.detail
    });
  }

  // PostgreSQL check constraint violation
  if (err.code === '23514') {
    return res.status(400).json({
      error: 'Check Constraint Violation',
      message: 'Operation violates database integrity rules.',
      detail: err.detail
    });
  }

  // Custom user-defined raise exception from PL/pgSQL
  if (err.code === 'P0001') {
    return res.status(400).json({
      error: 'Business Rule Violation',
      message: err.message
    });
  }

  const statusCode = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: err.name || 'ServerError',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : message
  });
}
