import { ObjectId } from 'mongodb';

/** Parse an id from a URL or a tool call. Returns null instead of throwing on garbage. */
export function oid(id: string): ObjectId | null {
  return ObjectId.isValid(id) && /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export function idOf(doc: { _id?: ObjectId }): string {
  if (!doc._id) throw new Error('document has no _id');
  return doc._id.toHexString();
}

/**
 * `{ a: number | undefined }` → `{ a?: number }`. Under `exactOptionalPropertyTypes` an explicit
 * `undefined` is not the same as an absent key, and Mongo would store it as `null`.
 */
export type Compact<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Drop undefined keys so DTOs and Mongo `$set` both stay clean. */
export function compact<T extends object>(obj: T): Compact<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Compact<T>;
}
