import { DeleteObjectCommand, ListObjectsV2Command, S3Client, type ListObjectsV2CommandInput } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoStore, userImagePrefix } from './s3';

const store = () => new PhotoStore({ hostname: 'example.test', accessKey: 'a', secretKey: 's', bucket: 'b', region: 'r' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PhotoStore.removeAll', () => {
  it("deletes every page of one user's photos, and asks for no one else's", async () => {
    const prefix = userImagePrefix('abc123');
    const deleted: string[] = [];
    const listed: ListObjectsV2CommandInput[] = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      if (command instanceof DeleteObjectCommand) deleted.push(command.input.Key!);
      if (command instanceof ListObjectsV2Command) {
        listed.push(command.input);
        return command.input.ContinuationToken ? { Contents: [{ Key: `${prefix}2.jpg` }], IsTruncated: false } : { Contents: [{ Key: `${prefix}1.jpg` }], IsTruncated: true, NextContinuationToken: 'next' };
      }
      return {};
    });

    await store().removeAll('abc123');

    expect(deleted).toEqual([`${prefix}1.jpg`, `${prefix}2.jpg`]);
    expect(listed.map((l) => l.Prefix)).toEqual([prefix, prefix]);
    expect(listed[1]?.ContinuationToken).toBe('next');
  });

  it('copes with a user who has no photos', async () => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({ IsTruncated: false }));
    await store().removeAll('abc123');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['', '../other', 'a/b', '*'])('refuses %j, which could reach past one user', async (userId) => {
    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
    await expect(store().removeAll(userId)).rejects.toThrow('user id');
    expect(send).not.toHaveBeenCalled();
  });
});
