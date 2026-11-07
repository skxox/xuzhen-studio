export type CreationMode = 'adaptation' | 'original';
export type ThemeName = 'dark' | 'light';

export interface Project {
  id: string;
  name: string;
  creation_mode: CreationMode;
  status: string;
  genre?: string | null;
  target_episodes?: number | null;
  episode_seconds?: number | null;
  aspect_ratio: string;
  rights_status: string;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  ordinal: number;
  title: string;
  body: string;
  content_hash: string;
  version: number;
  source_name?: string | null;
}

export interface ApiHealth {
  status: 'ok' | string;
  service: string;
}

export interface ChapterImportResult {
  filename: string;
  chapters: Array<{ id: string; ordinal: number; title: string; char_count: number; content_hash: string }>;
  review_required: boolean;
}

export interface ServiceProfile {
  id: string;
  modality: string;
  name: string;
  adapter_id: string;
  transport: string;
  endpoint: string;
  model_id: string;
  secret_ref?: string | null;
  enabled: boolean;
  version: number;
}

export interface ProjectCreateInput {
  name: string;
  creation_mode: CreationMode;
  genre?: string;
  target_episodes?: number;
  episode_seconds?: number;
  aspect_ratio: string;
  rights_status: 'unconfirmed' | 'owned' | 'licensed' | 'public_domain' | 'restricted';
}
