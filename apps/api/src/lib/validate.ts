import { validator } from 'hono/validator';
import type { z } from 'zod';

/**
 * Zod-validated JSON body / query. Going through Hono's validator (rather than parsing inside the
 * handler) is what puts the input type into `AppType`, so the SPA's `$post({ json })` is checked.
 */
export const json = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400);
    return parsed.data as z.infer<T>;
  });

export const query = <T extends z.ZodType>(schema: T) =>
  validator('query', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
    return parsed.data as z.infer<T>;
  });
