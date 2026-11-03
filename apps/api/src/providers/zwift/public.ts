import { ZwiftError } from './index';
import type { RequestGate } from '../gate';

const API = 'https://us-or-rly101.zwift.com';
const GAME_DICTIONARY = 'https://cdn.zwift.com/gameassets/GameDictionary.xml';
const TIMEOUT_MS = 20_000;
/** The most the public list returns per page (more is refused). */
export const PUBLIC_PAGE_LIMIT = 200;

export interface ZwiftPublicOptions {
  gate: RequestGate;
  log?: (line: string) => void;
  fetchFn?: typeof fetch;
}

/**
 * Zwift's no-login endpoints (DECISIONS #29): the public upcoming-events list (about the next day)
 * and the game's route dictionary. Same gate as the logged-in client, so the two never stack up.
 */
export class ZwiftPublic {
  private readonly fetchFn: typeof fetch;
  private readonly log: (line: string) => void;

  constructor(private readonly opts: ZwiftPublicOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.log = opts.log ?? ((line) => console.log(line));
  }

  /** Events `start`…`start + 200` in Zwift's order (by start time). */
  async upcomingPage(start: number): Promise<unknown[]> {
    const res = await this.send(`${API}/api/public/events/upcoming?start=${start}&limit=${PUBLIC_PAGE_LIMIT}`, 'application/json');
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw new ZwiftError('Zwift sent an unexpected events list');
    return body;
  }

  /** GameDictionary.xml — routes with length, climbing and lead-in. */
  async gameDictionary(): Promise<string> {
    return (await this.send(GAME_DICTIONARY, 'application/xml')).text();
  }

  private send(url: string, accept: string): Promise<Response> {
    return this.opts.gate.run(async () => {
      const started = Date.now();
      const { pathname, search } = new URL(url);
      let res: Response;
      try {
        res = await this.fetchFn(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        this.log(`zwift GET ${pathname}${search} failed (${Date.now() - started} ms)`);
        throw new ZwiftError(`Zwift unreachable: ${(err as Error).message}`);
      }
      this.log(`zwift GET ${pathname}${search} → ${res.status} (${Date.now() - started} ms)`);
      if (!res.ok) throw new ZwiftError(`Zwift error ${res.status} on ${pathname}`, res.status);
      return res;
    });
  }
}
