import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from './tools';

/** Every object node in a schema, including inside $defs and anyOf. */
function* objects(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) yield* objects(n);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj['type'] === 'object') yield obj;
  for (const v of Object.values(obj)) yield* objects(v);
}

describe('strict tool schemas', () => {
  it.each(TOOL_DEFINITIONS.map((t) => [t.name, t] as const))('%s is strict-compatible', (_n, tool) => {
    const json = JSON.stringify(tool.input_schema);
    for (const banned of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"oneOf"', '"pattern"', '"default"', '"$schema"']) {
      expect(json).not.toContain(banned);
    }
    for (const obj of objects(tool.input_schema)) expect(obj['additionalProperties']).toBe(false);
  });

  it('keeps the large schemas out of strict mode (the API caps the combined grammar size)', () => {
    // Making all of these strict again returns 400 "The compiled grammar is too large".
    // Re-check with `pnpm --filter @cycling-coach/api coach:smoke` before changing this list.
    expect(TOOL_DEFINITIONS.filter((t) => !t.strict).map((t) => t.name).sort()).toEqual([
      'build_recipe',
      'create_workout',
      'propose_calendar_changes',
      'propose_goal',
      'propose_plan',
      'propose_profile_update',
      'suggest_meals',
    ]);
  });

  it('keeps discriminators and enums enforceable', () => {
    const workout = JSON.stringify(TOOL_DEFINITIONS.find((t) => t.name === 'create_workout')!.input_schema);
    expect(workout).toContain('"const":"repeat"');
    const plan = JSON.stringify(TOOL_DEFINITIONS.find((t) => t.name === 'propose_plan')!.input_schema);
    expect(plan).toContain('"enum":["race","intervals","openers","endurance","recovery"]');
  });

  it('lets plan and change cards name the card they revise, optionally', () => {
    for (const name of ['propose_plan', 'propose_calendar_changes']) {
      const schema = TOOL_DEFINITIONS.find((t) => t.name === name)!.input_schema as { properties: object; required?: string[] };
      expect(schema.properties).toHaveProperty('replaces');
      expect(schema.required ?? []).not.toContain('replaces');
    }
  });

  it('keeps the tool list in a fixed order (it is the cached prompt prefix)', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toMatchSnapshot();
  });
});
