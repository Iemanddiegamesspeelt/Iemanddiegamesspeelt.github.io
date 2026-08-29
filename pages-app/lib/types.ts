export type ProfileRow = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  role: 'user' | 'moderator' | 'admin';
  banned_at?: string | null;
  restricted_until?: string | null;
  restriction_strikes?: number;
  last_restricted_at?: string | null;
  joined_at: string;
  macro_count: number;
  total_downloads: number;
  total_likes: number;
};

export type LevelRow = {
  id: string;
  name: string;
  creator: string;
  difficulty: string;
  demon_difficulty: string | null;
  stars: number | null;
  length: string;
  gd_version: string | null;
  macro_count: number;
  total_downloads: number;
  created_at: string;
};

export type MacroRow = {
  id: string;
  level_id: string;
  uploader_id: string;
  title: string;
  description: string | null;
  preview_video_url: string | null;
  completion: number | null;
  rate_kind: 'tps' | 'fps';
  rate: number | null;
  input_count: number;
  duration_seconds: number;
  player1_inputs: number;
  player2_inputs: number;
  recorded_gd_version: string | null;
  original_format_id: string;
  original_path: string;
  canonical_path: string;
  available_format_ids: string[];
  working_status: 'working' | 'unverified' | 'possibly_outdated' | 'broken' | 'removed';
  download_count: number;
  like_count: number;
  comment_count: number;
  working_votes?: number;
  broken_votes?: number;
  outdated_votes?: number;
  community_flagged_at?: string | null;
  community_restriction_applied_at?: string | null;
  created_at: string;
  level?: LevelRow;
  uploader?: ProfileRow;
};

export type CollectionRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  created_at: string;
  owner?: ProfileRow;
  collection_macros?: Array<{ macro_id: string }>;
};

export type CommentRow = {
  id: string;
  macro_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  author?: ProfileRow;
};
