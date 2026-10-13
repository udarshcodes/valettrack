export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed;
      next();
    } catch (err) {
      if (err.errors) {
        return res.status(400).json({
          error: 'Validation Error',
          message: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
          issues: err.errors
        });
      }
      next(err);
    }
  };
}
