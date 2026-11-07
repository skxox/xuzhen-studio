export type CreationMode = 'adaptation' | 'original' | 'commercial';
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

export interface CharacterReference {
  id: string;
  project_id: string;
  name: string;
  immutable_features: string;
  costume_rules: string;
  reference_views: Array<'front_full_body' | 'side_full_body' | 'back_full_body' | 'expression_sheet'>;
  status: 'draft' | 'needs_review' | 'accepted' | 'rejected';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CharacterReferenceCreateInput {
  name: string;
  immutable_features: string;
  costume_rules: string;
}

export interface CreativeBrief {
  id: string;
  project_id: string;
  premise: string;
  genre: string;
  target_readers: string;
  narrative_pov: string;
  planned_scope: string;
  style_baseline: string;
  constraints: string;
  rights_confirmed: boolean;
  revision: number;
  status: 'draft' | 'needs_review' | 'accepted';
  created_at: string;
  updated_at: string;
}

export type CreativeBriefSaveInput = Omit<CreativeBrief, 'id' | 'project_id' | 'revision' | 'status' | 'created_at' | 'updated_at'>;

export interface CommercialBrief {
  id: string;
  project_id: string;
  product_name: string;
  category: string;
  product_facts: string;
  target_audience: string;
  selling_points: string[];
  approved_claims: string[];
  prohibited_claims: string[];
  call_to_action: string;
  distribution_channel: string;
  target_seconds: number;
  rights_confirmed: boolean;
  revision: number;
  status: 'draft' | 'needs_review' | 'accepted';
  created_at: string;
  updated_at: string;
}

export type CommercialBriefSaveInput = Omit<CommercialBrief, 'id' | 'project_id' | 'revision' | 'status' | 'created_at' | 'updated_at'>;

export interface StageState {
  id: string;
  stage_key: string;
  label: string;
  responsibility: string;
  expected_output: string;
  depends_on: string[];
  status: 'not_started' | 'ready' | 'running' | 'needs_review' | 'accepted' | 'waived' | 'blocked' | 'stale' | 'failed';
  version: number;
  stale: boolean;
  decision: Record<string, unknown>;
}

export interface GenerationJobSummary {
  id: string;
  modality: 'text' | 'image' | 'video' | 'audio';
  stage_key: string;
  status: string;
  input_snapshot: Record<string, unknown>;
  provider_snapshot: Record<string, unknown>;
  error: Record<string, unknown>;
  created_at: string;
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
