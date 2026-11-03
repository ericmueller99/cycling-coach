import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Food photos (label, screenshot, front of pack) in the deployment's S3-compatible bucket — the same setup as
 * ez-scheduler-checkout: `https://S3_HOSTNAME`, path-style, credentials from the env. Only this
 * module talks to S3. Objects are private; the app shows them through short-lived signed URLs.
 * Everything lives under `cycling-coach/` because the bucket may be shared.
 */
export interface S3Config {
  hostname: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region: string;
}

export const FOOD_IMAGE_PREFIX = 'cycling-coach/food-images';

/** The key prefix a user's photos must have — checked before a key is attached to a food. */
export const userImagePrefix = (userId: string) => `${FOOD_IMAGE_PREFIX}/${userId}/`;

export class PhotoStore {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      endpoint: `https://${config.hostname}`,
      region: config.region,
      // S3-compatible providers (Vultr) don't do virtual-hosted buckets.
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=31536000' }));
  }

  /** A GET link valid for `seconds` (default 15 min). */
  signedUrl(key: string, seconds = 900): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { expiresIn: seconds });
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

/** A store when all four S3 vars are set; otherwise photos simply aren't kept. */
export function photoStoreFromEnv(env: { S3_HOSTNAME?: string | undefined; S3_ACCESS_KEY?: string | undefined; S3_SECRET_KEY?: string | undefined; S3_BUCKETNAME?: string | undefined; S3_REGION: string }): PhotoStore | null {
  const { S3_HOSTNAME: hostname, S3_ACCESS_KEY: accessKey, S3_SECRET_KEY: secretKey, S3_BUCKETNAME: bucket } = env;
  if (!hostname || !accessKey || !secretKey || !bucket) return null;
  return new PhotoStore({ hostname: hostname.replace(/^https?:\/\//, ''), accessKey, secretKey, bucket, region: env.S3_REGION });
}
