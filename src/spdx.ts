/**
 * Minimal SPDX license expression parser and evaluator.
 *
 * Supports the subset of the SPDX expression syntax that appears in npm package metadata:
 * license identifiers, the `+` suffix, `WITH <exception>`, `AND`, `OR` and parentheses.
 * Unparseable input is treated as a single opaque identifier so that odd values such as
 * `Custom: http://example.org` still flow through the policy as a normal (unknown) license.
 */

/** Result of evaluating an expression against the policy. */
export interface SpdxEvaluation {
  /** True when the expression as a whole satisfies the policy. */
  allowed: boolean;
  /** Identifiers that were accepted and carried the decision. */
  accepted: string[];
  /**
   * Identifiers of alternatives that were not accepted although the expression as a whole
   * is allowed. Non-empty only for `OR` expressions where the choice matters.
   */
  rejected: string[];
}

/** The policy an expression is evaluated against. */
export interface LicensePolicy {
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
}

type Node =
  | { type: 'id'; value: string }
  | { type: 'and'; left: Node; right: Node }
  | { type: 'or'; left: Node; right: Node };

const OPERATORS = new Set(['AND', 'OR', 'WITH']);

/**
 * Splits an expression into identifiers, operators and parentheses. Identifiers may contain
 * any character except whitespace and parentheses; `Custom: <url>` values are kept together
 * because they never contain a bare operator token.
 */
function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  let current = '';

  const flush = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (const character of expression) {
    if (character === '(' || character === ')') {
      flush();
      tokens.push(character);
    } else if (/\s/.test(character)) {
      flush();
    } else {
      current += character;
    }
  }
  flush();

  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: string[]) {}

  parse(): Node {
    const node = this.parseOr();
    if (this.index < this.tokens.length) {
      throw new Error(`Unexpected token "${this.tokens[this.index]}"`);
    }
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek() === 'OR') {
      this.index++;
      left = { type: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseAtom();
    while (this.peek() === 'AND') {
      this.index++;
      left = { type: 'and', left, right: this.parseAtom() };
    }
    return left;
  }

  private parseAtom(): Node {
    const token = this.peek();
    if (token === undefined) {
      throw new Error('Unexpected end of expression');
    }

    if (token === '(') {
      this.index++;
      const node = this.parseOr();
      if (this.peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      this.index++;
      return node;
    }

    if (token === ')' || OPERATORS.has(token)) {
      throw new Error(`Unexpected token "${token}"`);
    }

    this.index++;
    let value = token;

    // `<id> WITH <exception>` forms a single license identifier.
    if (this.peek() === 'WITH') {
      this.index++;
      const exception = this.peek();
      if (
        exception === undefined ||
        OPERATORS.has(exception) ||
        exception === ')'
      ) {
        throw new Error('Missing license exception after WITH');
      }
      this.index++;
      value = `${value} WITH ${exception}`;
    }

    return { type: 'id', value };
  }

  private peek(): string | undefined {
    return this.tokens[this.index];
  }
}

/** Parses an SPDX expression, falling back to a single opaque identifier. */
function parse(expression: string): Node {
  const trimmed = expression.trim();
  try {
    return new Parser(tokenize(trimmed)).parse();
  } catch {
    return { type: 'id', value: trimmed };
  }
}

/**
 * Matches an identifier against the policy. The `+` suffix ("this version or later") and a
 * `WITH` exception do not change which base license is being granted, so both are also
 * matched against the plain identifier.
 */
function isAllowedId(id: string, policy: LicensePolicy): boolean {
  const candidates = [id];
  const withIndex = id.indexOf(' WITH ');
  const base = withIndex === -1 ? id : id.slice(0, withIndex);
  candidates.push(base);
  if (base.endsWith('+')) {
    candidates.push(base.slice(0, -1));
  }

  if (candidates.some(candidate => policy.deny.has(candidate))) {
    return false;
  }
  return candidates.some(candidate => policy.allow.has(candidate));
}

function evaluateNode(node: Node, policy: LicensePolicy): SpdxEvaluation {
  if (node.type === 'id') {
    const allowed = isAllowedId(node.value, policy);
    return {
      allowed,
      accepted: allowed ? [node.value] : [],
      rejected: allowed ? [] : [node.value],
    };
  }

  const left = evaluateNode(node.left, policy);
  const right = evaluateNode(node.right, policy);

  if (node.type === 'and') {
    // Every part of an AND must be satisfied; nothing is optional, so nothing is "rejected
    // but survivable" - a failing part simply makes the whole expression fail.
    const allowed = left.allowed && right.allowed;
    return {
      allowed,
      accepted: allowed ? [...left.accepted, ...right.accepted] : [],
      rejected: allowed ? [] : [...left.rejected, ...right.rejected],
    };
  }

  // OR: one satisfied alternative is enough, the others are recorded as not accepted.
  const allowed = left.allowed || right.allowed;
  return {
    allowed,
    accepted: [...left.accepted, ...right.accepted],
    rejected: [...left.rejected, ...right.rejected],
  };
}

/** Evaluates an SPDX license expression against the policy. */
export function evaluateExpression(
  expression: string,
  policy: LicensePolicy
): SpdxEvaluation {
  return evaluateNode(parse(expression), policy);
}

/** Returns the distinct license identifiers used in an expression. */
export function collectIdentifiers(expression: string): string[] {
  const identifiers: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === 'id') {
      identifiers.push(node.value);
      return;
    }
    visit(node.left);
    visit(node.right);
  };
  visit(parse(expression));
  return [...new Set(identifiers)];
}
