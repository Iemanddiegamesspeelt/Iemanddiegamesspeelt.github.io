import 'server-only';
import { env } from 'cloudflare:workers';

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
}

export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, options: { contentType: string; metadata?: Record<string, string> }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

class R2Storage implements ObjectStorage {
  async put(key: string, bytes: Uint8Array, options: { contentType: string; metadata?: Record<string, string> }) {
    await env.FILES.put(key, bytes, {
      httpMetadata: { contentType: options.contentType },
      customMetadata: options.metadata,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = await env.FILES.get(key);
    if (!object) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      metadata: object.customMetadata ?? {},
    };
  }

  async delete(key: string) {
    await env.FILES.delete(key);
  }
}

export function getObjectStorage(): ObjectStorage {
  return new R2Storage();
}

export function randomStorageKey(prefix: 'quarantine' | 'canonical' | 'original' | 'avatar' | 'cache', extension = ''): string {
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
}

