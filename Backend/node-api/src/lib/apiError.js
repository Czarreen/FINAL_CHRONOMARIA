const IS_PROD = process.env.NODE_ENV === 'production';

export function safeErrorMessage(err) {
  if (!IS_PROD) {
    return err instanceof Error ? err.message : String(err || 'Unknown error');
  }
  return 'An internal server error occurred';
}

export function safeSupabaseError(error) {
  if (!IS_PROD) return error?.message || 'Database error';
  return 'A database error occurred';
}
