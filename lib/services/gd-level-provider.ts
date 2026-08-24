import { z } from 'zod';
import type { DemonDifficulty, LevelDifficulty, LevelLength } from '../data/types';

export interface GeometryDashLevelMetadata {
  id: string;
  name: string;
  creator: string;
  difficulty: LevelDifficulty;
  demonDifficulty?: DemonDifficulty;
  stars?: number;
  length: LevelLength;
  geometryDashVersion?: string;
  fetchedAt: string;
  source: string;
}

export interface GeometryDashLevelProvider {
  getLevel(levelId: string): Promise<GeometryDashLevelMetadata | null>;
  searchLevels(query: string, limit?: number): Promise<GeometryDashLevelMetadata[]>;
}

export class UnconfiguredGeometryDashLevelProvider implements GeometryDashLevelProvider {
  async getLevel() {
    return null;
  }

  async searchLevels() {
    return [];
  }
}

const metadataSchema = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  name: z.string().min(1).max(120),
  creator: z.string().min(1).max(80),
  difficulty: z.enum(['Auto', 'Easy', 'Normal', 'Hard', 'Harder', 'Insane', 'Demon', 'Unknown']),
  demonDifficulty: z.enum(['Easy', 'Medium', 'Hard', 'Insane', 'Extreme']).optional(),
  stars: z.number().int().min(0).max(10).optional(),
  length: z.enum(['Tiny', 'Short', 'Medium', 'Long', 'XL', 'Platformer', 'Unknown']),
  geometryDashVersion: z.string().max(32).optional(),
  fetchedAt: z.string().datetime(),
  source: z.string().min(1).max(120),
}).passthrough();

export class HttpGeometryDashLevelProvider implements GeometryDashLevelProvider {
  constructor(private readonly baseUrl: string) {}

  private endpoint(pathname: string) {
    return new URL(pathname, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
  }

  async getLevel(levelId: string): Promise<GeometryDashLevelMetadata | null> {
    const response = await fetch(this.endpoint(`levels/${encodeURIComponent(levelId)}`), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Geometry Dash metadata provider is unavailable.');
    const parsed = metadataSchema.parse(await response.json());
    return parsed.id === levelId ? parsed : null;
  }

  async searchLevels(query: string, limit = 8): Promise<GeometryDashLevelMetadata[]> {
    const endpoint = this.endpoint('levels');
    endpoint.searchParams.set('q', query.slice(0, 120));
    endpoint.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 20)));
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('Geometry Dash metadata provider is unavailable.');
    return z.array(metadataSchema).max(20).parse(await response.json());
  }
}

export function getGeometryDashLevelProvider(): GeometryDashLevelProvider {
  const endpoint = process.env.GD_LEVEL_PROVIDER_URL;
  if (endpoint) return new HttpGeometryDashLevelProvider(endpoint);
  return new UnconfiguredGeometryDashLevelProvider();
}
