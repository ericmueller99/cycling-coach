import { MongoClient, type Db } from 'mongodb';

export interface Mongo {
  client: MongoClient;
  db: Db;
}

/**
 * One client per process. A shared Mongo cluster should give this app a database user that can
 * only touch its own database (docs/DECISIONS.md #4) — isolation enforced by the server, not by
 * remembering which db name to pass.
 */
export function createMongo(uri: string, dbName: string): Mongo {
  const client = new MongoClient(uri, { appName: 'cycling-coach' });
  return { client, db: client.db(dbName) };
}
