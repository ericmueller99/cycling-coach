/**
 * Zod JSON Schema → the subset strict tool use accepts.
 *
 * Supported: types, enum, const, anyOf, allOf, $ref/$defs, a few string formats, minItems 0/1,
 * and `additionalProperties: false` on every object. Numeric and length limits are not, so they
 * move into the description where the model can still read them; Zod enforces them when the tool
 * runs. (The SDK ships a similar transform, but it also demotes `enum` and `const`, which would
 * leave session types and segment kinds unconstrained.)
 */
type Json = Record<string, unknown>;

const STRING_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const IGNORED = new Set(['$schema', 'id', '$id']);

function walk(input: Json): Json {
  const rest: Json = { ...input };
  const take = (key: string) => {
    const value = rest[key];
    delete rest[key];
    return value;
  };
  for (const key of IGNORED) delete rest[key];

  const out: Json = {};
  const defs = take('$defs') as Record<string, Json> | undefined;
  if (defs) out['$defs'] = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, walk(v)]));

  const ref = take('$ref');
  if (ref !== undefined) {
    out['$ref'] = ref;
    return out;
  }

  const type = take('type');
  const anyOf = (take('anyOf') ?? take('oneOf')) as Json[] | undefined;
  const allOf = take('allOf') as Json[] | undefined;
  if (anyOf) out['anyOf'] = anyOf.map(walk);
  else if (allOf) out['allOf'] = allOf.map(walk);
  if (type !== undefined) out['type'] = type;

  for (const key of ['description', 'title', 'enum', 'const']) {
    const value = take(key);
    if (value !== undefined) out[key] = value;
  }

  if (type === 'object') {
    const properties = (take('properties') ?? {}) as Record<string, Json>;
    out['properties'] = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, walk(v)]));
    take('additionalProperties');
    out['additionalProperties'] = false;
    const required = take('required');
    if (required !== undefined) out['required'] = required;
  } else if (type === 'string') {
    const format = take('format');
    if (typeof format === 'string' && STRING_FORMATS.has(format)) out['format'] = format;
    else if (format !== undefined) rest['format'] = format;
  } else if (type === 'array') {
    const items = take('items') as Json | undefined;
    if (items) out['items'] = walk(items);
    const minItems = take('minItems');
    if (minItems === 0 || minItems === 1) out['minItems'] = minItems;
    else if (minItems !== undefined) rest['minItems'] = minItems;
  }

  const leftovers = Object.entries(rest);
  if (leftovers.length) {
    const note = `{${leftovers.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`;
    out['description'] = out['description'] ? `${String(out['description'])}\n\n${note}` : note;
  }
  return out;
}

export function toStrictSchema(schema: Json): Json {
  return walk(JSON.parse(JSON.stringify(schema)) as Json);
}
