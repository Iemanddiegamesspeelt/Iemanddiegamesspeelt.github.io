import type { CanonicalReplayV1 } from '../replay/types';

export type LevelDifficulty = 'Auto' | 'Easy' | 'Normal' | 'Hard' | 'Harder' | 'Insane' | 'Demon' | 'Unknown';
export type DemonDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Insane' | 'Extreme';
export type LevelLength = 'Tiny' | 'Short' | 'Medium' | 'Long' | 'XL' | 'Platformer' | 'Unknown';
export type WorkingStatus = 'Working' | 'Unverified' | 'Possibly outdated' | 'Broken' | 'Removed';

export interface ProfileRecord {
  id: string;
  username: string;
  displayName: string;
  initials: string;
  avatarTone: string;
  avatarUrl?: string;
  bio: string;
  joinedAt: string;
  macroCount: number;
  totalDownloads: number;
  totalLikes: number;
  role: 'user' | 'moderator' | 'admin';
}

export interface LevelRecord {
  id: string;
  name: string;
  creator: string;
  difficulty: LevelDifficulty;
  demonDifficulty?: DemonDifficulty;
  stars?: number;
  length: LevelLength;
  gdVersion?: string;
  macroCount: number;
  totalDownloads: number;
  accent: 'violet' | 'cyan' | 'rose' | 'amber' | 'emerald' | 'blue';
  isDemo: boolean;
}

export interface MacroRecord {
  id: string;
  levelId: string;
  uploaderId: string;
  title: string;
  description: string;
  completion?: number;
  tps?: number;
  fps?: number;
  inputCount: number;
  durationSeconds: number;
  player1Inputs: number;
  player2Inputs: number;
  recordedGdVersion?: string;
  originalFormatId: string;
  uploadedAt: string;
  downloadCount: number;
  likeCount: number;
  commentCount: number;
  status: WorkingStatus;
  isDemo: boolean;
  canonical?: CanonicalReplayV1;
  availableFormatIds?: string[];
  compatibleToolIds?: string[];
  formatCapabilities?: Array<{
    formatId: string;
    tools: Array<{
      id: string;
      name: string;
      recommended: boolean;
      supportLevel: 'NATIVE' | 'COMPATIBLE' | 'EXPERIMENTAL';
      verification: 'verified' | 'community-reported';
      warning?: string;
    }>;
  }>;
}

export interface CommentRecord {
  id: string;
  macroId: string;
  authorId: string;
  parentId?: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  state: 'visible' | 'deleted' | 'removed';
}

export interface CollectionRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  visibility: 'public' | 'unlisted' | 'private';
  macroIds: string[];
  updatedAt: string;
  accent: 'violet' | 'cyan' | 'rose' | 'amber';
}
