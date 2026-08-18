/**
 * Errors that make a scan incomplete, and the collector that gathers them.
 *
 * A license checker that reports success because it could not look is worse than no checker
 * at all. Every place that reads the file system therefore has to tell "this is not there",
 * which is information, apart from "I could not read this", which means the answer is
 * unknown. The second case is recorded here and fails the run.
 *
 * Errors are collected rather than thrown: one unreadable directory should not hide the rest
 * of the tree, so the run continues and reports everything it could not examine at once.
 */

/** What kind of thing could not be examined. */
export type ScanErrorKind =
  | 'dependencies-not-installed'
  | 'unresolved-dependency'
  | 'unreadable-directory'
  | 'unreadable-manifest'
  | 'invalid-manifest'
  | 'unreadable-package'
  | 'unreadable-license-file';

/** A single thing the scan could not examine. */
export interface ScanError {
  kind: ScanErrorKind;
  /** What could not be examined, said in one sentence. */
  message: string;
  /** Absolute path the error is about. */
  path: string;
  /** The errno of the underlying system call, when there was one. */
  code?: string;
  /** Name of the dependency that could not be resolved. */
  dependency?: string;
  /** The package that requires it, as `name@version`. */
  requiredBy?: string;
  /** Where the requiring package lives. */
  requiredByPath?: string;
  /** Directories that were searched, for a dependency that could not be found. */
  searched?: string[];
  /** What the reader should do about it. */
  hint?: string;
}

/** The errno of a failed system call, when the error carries one. */
export function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * True when the error only says that the path does not exist. That is an answer, not a
 * failure: a package without nested dependencies has no `node_modules` directory.
 */
export function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

/** Collects the errors of one scan. */
export class ScanDiagnostics {
  private readonly collected: ScanError[] = [];

  record(error: ScanError): void {
    this.collected.push(error);
  }

  /** The recorded errors, in the order they occurred. */
  get errors(): readonly ScanError[] {
    return this.collected;
  }

  /** True when something could not be examined, so the result is not the whole truth. */
  get incomplete(): boolean {
    return this.collected.length > 0;
  }
}
