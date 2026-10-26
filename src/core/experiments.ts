import type { ExperimentResult, ExperimentSpec, Expression } from './types';

type Quantity = { value: number; dimensions: Record<string, number> };
const units = new Set(['1', 'm', 's', 'kg', 'K', 'A', 'mol', 'cd', 'USD']);
const fail = (reason: string): never => { throw new Error(`Invalid experiment: ${reason}`); };
const dimensions = (unit = '1'): Record<string, number> => {
  if (typeof unit !== 'string' || unit.length < 1 || unit.length > 80) return fail('unit must contain 1–80 characters');
  // A small left-associative product/quotient grammar, with at most eight base-unit factors.
  // A divisor negates only its following factor: kg*m/s^2 and m*s^-1 need no executable parser.
  const tokens = unit.trim().split(/([*/·])/u);
  if (tokens.length > 15) return fail('unit has too many factors');
  const result: Record<string, number> = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const match = /^(1|[A-Za-z]+)(?:\^(-?\d{1,2}))?$/.exec(tokens[index]?.trim() ?? '');
    if (!match || !units.has(match[1])) return fail('unsupported unit or syntax');
    const exponent = match[2] === undefined ? 1 : Number(match[2]);
    if (Math.abs(exponent) > 8) return fail('unit power must be from -8 to 8');
    if (match[1] === '1') continue;
    const power = exponent * (index > 0 && tokens[index - 1] === '/' ? -1 : 1);
    result[match[1]] = (result[match[1]] ?? 0) + power;
    if (Math.abs(result[match[1]]) > 16) return fail('unit dimension exceeds bounds');
  }
  return result;
};
const unitLabel = (d: Record<string, number>): string => Object.keys(d).filter(k => d[k] !== 0).sort().map(k => d[k] === 1 ? k : `${k}^${d[k]}`).join(' · ') || '1';
const combine = (a: Record<string, number>, b: Record<string, number>, sign: number) => {
  const result = { ...a };
  for (const [key, power] of Object.entries(b)) result[key] = (result[key] ?? 0) + power * sign;
  return result;
};

/** Bounded arithmetic AST; no source text, JavaScript, functions, or property access is executed. */
export function evaluateExperiment(spec: ExperimentSpec, inputs: Record<string, number>): ExperimentResult {
  if (!Array.isArray(spec.variables) || spec.variables.length > 16 || !Array.isArray(spec.assumptions) || spec.assumptions.length > 16) fail('too many inputs or assumptions');
  const variables = new Map<string, Quantity>();
  for (const variable of spec.variables) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(variable.name) || variables.has(variable.name)) fail('invalid or duplicate variable');
    if (!Number.isFinite(variable.min) || !Number.isFinite(variable.max) || variable.min > variable.max) fail('invalid input bounds');
    const value = inputs[variable.name];
    if (!Object.hasOwn(inputs, variable.name) || !Number.isFinite(value) || value < variable.min || value > variable.max) fail(`input ${variable.name} is outside bounds`);
    variables.set(variable.name, { value, dimensions: dimensions(variable.unit) });
  }
  if (Object.keys(inputs).some(name => !variables.has(name))) fail('unknown input');
  let nodes = 0;
  const evaluate = (expression: Expression, depth: number): Quantity => {
    if (++nodes > 128 || depth > 20 || !expression || typeof expression !== 'object') return fail('expression exceeds bounds');
    let result: Quantity;
    switch (expression.op) {
      case 'constant': result = { value: expression.value, dimensions: dimensions(expression.unit) }; break;
      case 'variable': { const value = variables.get(expression.name); if (!value) return fail('unknown variable'); result = value; break; }
      case 'power': {
        if (!Number.isInteger(expression.exponent) || Math.abs(expression.exponent) > 8) return fail('power must be an integer from -8 to 8');
        const base = evaluate(expression.base, depth + 1);
        result = { value: base.value ** expression.exponent, dimensions: Object.fromEntries(Object.entries(base.dimensions).map(([unit, power]) => [unit, power * expression.exponent])) }; break;
      }
      case 'add': case 'subtract': case 'multiply': case 'divide': {
        const a = evaluate(expression.left, depth + 1), b = evaluate(expression.right, depth + 1);
        if (expression.op === 'add' || expression.op === 'subtract') {
          if (unitLabel(a.dimensions) !== unitLabel(b.dimensions)) return fail('addition requires matching units');
          result = { value: expression.op === 'add' ? a.value + b.value : a.value - b.value, dimensions: a.dimensions };
        } else {
          if (expression.op === 'divide' && b.value === 0) return fail('division by zero');
          result = { value: expression.op === 'multiply' ? a.value * b.value : a.value / b.value, dimensions: combine(a.dimensions, b.dimensions, expression.op === 'multiply' ? 1 : -1) };
        }
        break;
      }
      default: return fail('unsupported operation');
    }
    if (!Number.isFinite(result.value) || Math.abs(result.value) > 1e15) return fail('non-finite or excessive result');
    return result;
  };
  const result = evaluate(spec.expression, 0);
  return { value: result.value, unit: unitLabel(result.dimensions), assumptions: [...spec.assumptions] };
}
