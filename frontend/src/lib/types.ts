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
  rights_status: 'unconfirmed' | 'owned' | 'licensed' | 'public_domain' | 'restricted';
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

export interface ManuscriptRelease {
  id: string;
  project_id: string;
  revision: number;
  chapter_start: number;
  chapter_end: number;
  chapter_versions: Array<{
    ordinal: number;
    chapter_id: string;
    version: number;
    content_hash: string;
  }>;
  continuity_job_id: string;
  continuity_revision: number;
  rights_status: Project['rights_status'];
  risk_ack: boolean;
  decision_reason?: string | null;
  previous_release_id?: string | null;
  is_current: boolean;
  created_at: string;
}

export interface AdaptationBranch {
  id: string;
  project_id: string;
  release_id: string;
  revision: number;
  episode_count: number;
  episode_seconds: number;
  aspect_ratio: string;
  previous_branch_id?: string | null;
  is_current: boolean;
  created_at: string;
  episodes: Array<{
    episode_number: number;
    chapter_ordinals: number[];
    target: string;
    conflict: string;
    turn: string;
    ending_hook: string;
    preserve_facts: string;
    allowed_changes: string;
    adaptation_note: string;
  }>;
}

export interface AdaptationOutlineRelease {
  id: string;
  branch_id: string;
  revision: number;
  job_id: string;
  episode_count: number;
  creative_thesis: string;
  is_current: boolean;
  created_at: string;
  episodes: Array<{
    episode_number: number;
    source_chapter_ordinals: number[];
    adaptation_summary: string;
    emotional_arc: string;
    ending_hook: string;
    scenes: AdaptationOutlineScene[];
  }>;
}

export interface AdaptationOutlineBeat {
  beat_number: number;
  action: string;
  turn: string;
}

export interface AdaptationOutlineScene {
  scene_number: number;
  slugline: string;
  location: string;
  time_of_day: string;
  character_names: string[];
  purpose: string;
  conflict: string;
  estimated_seconds: number;
  source_chapter_ordinals: number[];
  is_adaptation_addition: boolean;
  beats: AdaptationOutlineBeat[];
}

export interface ScriptRelease {
  id: string;
  branch_id: string;
  outline_release_id: string;
  revision: number;
  job_id: string;
  character_job_id: string;
  art_job_id: string;
  episode_count: number;
  episodes: Array<{
    episode_number: number;
    scenes: Array<{
      scene_number: number;
      action: string;
      action_seconds: number;
      dialogues: Array<{
        dialogue_number: number;
        speaker: string;
        text: string;
        emotion: string;
        delivery: string;
        estimated_seconds: number;
        source_chapter_ordinals: number[];
        origin: 'direct_quote' | 'adaptation' | 'original';
      }>;
    }>;
  }>;
  is_current: boolean;
  created_at: string;
}

export type EpisodeScript = ScriptRelease['episodes'][number];
export type ScriptScene = EpisodeScript['scenes'][number];
export type ScriptDialogue = ScriptScene['dialogues'][number];

export interface ShotPlanRelease {
  id: string;
  branch_id: string;
  script_release_id: string;
  revision: number;
  job_id: string;
  character_job_id: string;
  art_job_id: string;
  episode_count: number;
  shot_count: number;
  episodes: Array<{
    episode_number: number;
    scenes: Array<{
      scene_number: number;
      shots: Array<{
        shot_number: number;
        shot_size: string;
        camera_angle: string;
        camera_movement: string;
        composition: string;
        visible_action: string;
        character_names: string[];
        asset_refs: string[];
        dialogue_numbers: number[];
        duration_seconds: number;
        source_chapter_ordinals: number[];
        continuity_anchors: string[];
        visual_prompt: string;
        negative_prompt: string;
        transition: string;
      }>;
    }>;
  }>;
  is_current: boolean;
  created_at: string;
}

export interface KeyframeCandidate {
  id: string;
  branch_id: string;
  shot_plan_release_id: string;
  job_id: string;
  episode_number: number;
  scene_number: number;
  shot_number: number;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  prompt: string;
  provider_snapshot: Record<string, unknown>;
  status: 'needs_review' | 'accepted' | 'rejected' | 'superseded';
  created_at: string;
  file_url: string;
}

export interface VideoCandidate {
  id: string;
  branch_id: string;
  shot_plan_release_id: string;
  keyframe_candidate_id: string;
  job_id: string;
  provider_task_id: string;
  episode_number: number;
  scene_number: number;
  shot_number: number;
  requested_seconds: number;
  progress: number;
  content_type?: string | null;
  size_bytes?: number | null;
  sha256?: string | null;
  prompt: string;
  provider_snapshot: Record<string, unknown>;
  error: Record<string, unknown>;
  status:
    | 'queued'
    | 'processing'
    | 'needs_review'
    | 'accepted'
    | 'rejected'
    | 'superseded'
    | 'failed'
    | 'stale';
  created_at: string;
  file_url?: string | null;
}

export interface EditPackage {
  id: string;
  revision: number;
  shot_count: number;
  subtitle_count: number;
  audio_count: number;
  subtitle_srt?: string;
  size_bytes: number;
  sha256: string;
  source_snapshot: {
    shot_plan_release_id: string;
    shot_plan_revision: number;
    script_release_id: string;
    script_revision: number;
    video_candidate_ids: string[];
    audio_candidate_ids: string[];
    subtitle_preview: Array<{ start_ms: number; end_ms: number; text: string }>;
  };
  status: 'needs_review' | 'accepted' | 'rejected';
  created_at: string;
  file_url: string;
}

export interface AudioCandidate {
  id: string;
  branch_id: string;
  script_release_id: string;
  job_id: string;
  episode_number: number;
  scene_number: number;
  dialogue_number: number;
  content_type: string;
  size_bytes: number;
  sha256: string;
  text: string;
  voice_id: string;
  provider_snapshot: Record<string, unknown>;
  status: 'needs_review' | 'accepted' | 'rejected' | 'superseded' | 'stale';
  created_at: string;
  file_url: string;
}

export interface ApiHealth {
  status: 'ok' | string;
  service: string;
}

export interface ChapterImportResult {
  filename: string;
  chapters: Array<{
    id: string;
    ordinal: number;
    title: string;
    char_count: number;
    content_hash: string;
  }>;
  review_required: boolean;
}

export interface CharacterReference {
  id: string;
  project_id: string;
  name: string;
  immutable_features: string;
  costume_rules: string;
  reference_views: Array<
    'front_full_body' | 'side_full_body' | 'back_full_body' | 'expression_sheet'
  >;
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

export type CreativeBriefSaveInput = Omit<
  CreativeBrief,
  'id' | 'project_id' | 'revision' | 'status' | 'created_at' | 'updated_at'
>;

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

export type CommercialBriefSaveInput = Omit<
  CommercialBrief,
  'id' | 'project_id' | 'revision' | 'status' | 'created_at' | 'updated_at'
>;

export interface CommercialMaterial {
  id: string;
  project_id: string;
  original_name: string;
  media_kind: 'image' | 'video' | 'document';
  content_type: string;
  size_bytes: number;
  sha256: string;
  rights_status: 'owned' | 'licensed' | 'public_domain' | 'restricted';
  created_at: string;
  file_url: string;
}

export interface StageState {
  id: string;
  stage_key: string;
  label: string;
  responsibility: string;
  expected_output: string;
  depends_on: string[];
  status:
    | 'not_started'
    | 'ready'
    | 'running'
    | 'needs_review'
    | 'accepted'
    | 'waived'
    | 'blocked'
    | 'stale'
    | 'failed';
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
  output?: {
    id: string;
    content_type: string;
    content: string;
    metadata: Record<string, unknown>;
    revision?: number;
  } | null;
  error: Record<string, unknown>;
  created_at: string;
}

export interface ServiceProfile {
  id: string;
  modality: 'text' | 'image' | 'video' | 'audio';
  name: string;
  adapter_id: string;
  transport: string;
  endpoint: string;
  model_id: string;
  secret_ref?: string | null;
  secret_configured?: boolean;
  connection_test?: {
    status: 'connected' | 'failed';
    model_available: boolean;
    checked_at: string;
    error_code?: string;
  } | null;
  capabilities?: Record<string, unknown>;
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
