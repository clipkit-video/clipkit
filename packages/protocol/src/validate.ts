import type { Source } from './types.js';
import { sourceSchema } from './zod.js';

export interface ValidationIssue {
  /** Path to the offending value, as a sequence of object keys and array indices. */
  path: (string | number)[];
  /** Human-readable error message. */
  message: string;
  /** Zod issue code (e.g. `invalid_type`, `invalid_enum_value`). */
  code: string;
}

export type ValidationResult =
  | { valid: true; data: Source }
  | { valid: false; errors: ValidationIssue[] };

/**
 * Validates a value against the Clipkit schema.
 *
 * Pure function — synchronous, no I/O. Accepts already-parsed JSON or a raw
 * JSON string. Returns the parsed `Source` on success, or a list of issues
 * on failure.
 */
export function validate(input: unknown): ValidationResult {
  let candidate: unknown = input;

  if (typeof input === 'string') {
    try {
      candidate = JSON.parse(input);
    } catch (e) {
      return {
        valid: false,
        errors: [
          {
            path: [],
            message: `Invalid JSON: ${(e as Error).message}`,
            code: 'invalid_json',
          },
        ],
      };
    }
  }

  const result = sourceSchema.safeParse(candidate);
  if (result.success) {
    return { valid: true, data: result.data as Source };
  }

  return {
    valid: false,
    errors: result.error.issues.map((issue) => ({
      path: [...issue.path],
      message: issue.message,
      code: issue.code,
    })),
  };
}
