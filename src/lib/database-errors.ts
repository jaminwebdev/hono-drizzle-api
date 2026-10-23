import { ApiError } from './http.js';

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const cause = error instanceof Error ? error.cause : undefined;
  const driverError = cause instanceof Error ? cause : error;
  const code = driverError instanceof Error && 'code' in driverError ? driverError.code : undefined;
  if (code === '23505') return new ApiError(409, 'CONFLICT', 'That name is already in use.');
  if (code === '23503' || code === '23001') {
    return new ApiError(409, 'CONFLICT', 'The change conflicts with related records.');
  }
  if (code === '23514' || code === '23502') {
    return new ApiError(422, 'VALIDATION_ERROR', 'Request values are invalid.');
  }
  if (typeof code === 'string' && (code.startsWith('08') || [
    '57P01', '57P02', '57P03', '57014', '53300', '55P03',
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  ].includes(code))) return new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database is unavailable.');
  if (driverError instanceof Error && [
    'Connection terminated due to connection timeout', 'Query read timeout', 'Connection terminated unexpectedly',
  ].includes(driverError.message)) return new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database is unavailable.');
  return new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
