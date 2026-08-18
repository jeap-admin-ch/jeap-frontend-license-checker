/**
 * The result of looking something up on the file system.
 *
 * Returning `undefined` for both "it is not there" and "I could not read it" is what lets a
 * caller skip a dependency that was never examined, so the two are separate cases here and
 * the compiler makes every caller decide what to do with each.
 */
import type { ScanError } from './diagnostics';

/** Either the value, a definite absence, or a failure to look. */
export type Outcome<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'failed'; error: ScanError };

export function found<T>(value: T): Outcome<T> {
  return { status: 'found', value };
}

export function missing<T>(): Outcome<T> {
  return { status: 'missing' };
}

export function failed<T>(error: ScanError): Outcome<T> {
  return { status: 'failed', error };
}
