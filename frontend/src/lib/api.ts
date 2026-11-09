import type {
  ApiHealth,
  AdaptationBranch,
  AdaptationOutlineRelease,
  AudioCandidate,
  Chapter,
  ChapterImportResult,
  CharacterReference,
  CharacterReferenceCreateInput,
  CommercialBrief,
  CommercialBriefSaveInput,
  CommercialMaterial,
  CreativeBrief,
  CreativeBriefSaveInput,
  DeliveryMaster,
  DeliveryRuntime,
  EditPackage,
  GenerationJobSummary,
  KeyframeCandidate,
  VideoCandidate,
  ManuscriptRelease,
  Project,
  ProjectCreateInput,
  ServiceProfile,
  ScriptRelease,
  ShotPlanRelease,
  StageState,
} from './types';

const API_ROOT = import.meta.env.VITE_API_ROOT ?? '/api';

/** 携带后端错误 detail 的请求异常；message 已整理为可读文本。 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

interface ValidationErrorItem {
  loc?: Array<string | number>;
  msg?: string;
}

function isValidationErrorItem(value: unknown): value is ValidationErrorItem {
  return typeof value === 'object' && value !== null;
}

function readableErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .filter(isValidationErrorItem)
      .map((item) => (typeof item.msg === 'string' ? item.msg : undefined))
      .filter((message): message is string => Boolean(message));
    if (messages.length) return messages.join('；');
  }
  return fallback;
}

/** 从 422 校验错误中按字段名提取消息，如 { content_mode: '…' }。 */
export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.detail)) return {};
  const result: Record<string, string> = {};
  for (const item of error.detail) {
    if (!isValidationErrorItem(item) || typeof item.msg !== 'string') continue;
    if (!Array.isArray(item.loc)) continue;
    const field = item.loc[item.loc.length - 1];
    if (typeof field === 'string' && !(field in result)) result[field] = item.msg;
  }
  return result;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      parsed = null;
    }
    const detail =
      parsed !== null && typeof parsed === 'object' && 'detail' in parsed
        ? (parsed as { detail: unknown }).detail
        : raw || null;
    throw new ApiError(
      response.status,
      detail,
      readableErrorMessage(detail, `Request failed (${response.status})`),
    );
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<ApiHealth>('/health'),
  projects: () => request<Project[]>('/projects'),
  createProject: (body: ProjectCreateInput) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProjectRights: (projectId: string, rights_status: Project['rights_status']) =>
    request<Project>(`/projects/${projectId}/rights`, {
      method: 'PATCH',
      body: JSON.stringify({ rights_status }),
    }),
  chapters: (projectId: string) => request<Chapter[]>(`/projects/${projectId}/chapters`),
  reviseChapter: (projectId: string, chapterId: string, body: Pick<Chapter, 'title' | 'body'>) =>
    request<Pick<Chapter, 'id' | 'ordinal' | 'title' | 'content_hash' | 'version'>>(
      `/projects/${projectId}/chapters/${chapterId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  chapterVersions: (projectId: string, chapterId: string) =>
    request<Chapter[]>(`/projects/${projectId}/chapters/${chapterId}/versions`),
  restoreChapterVersion: (projectId: string, chapterId: string, version: number) =>
    request<Pick<Chapter, 'id' | 'ordinal' | 'title' | 'content_hash' | 'version'>>(
      `/projects/${projectId}/chapters/${chapterId}/restore`,
      { method: 'POST', body: JSON.stringify({ version }) },
    ),
  characterReferences: (projectId: string) =>
    request<CharacterReference[]>(`/projects/${projectId}/character-references`),
  createCharacterReference: (projectId: string, body: CharacterReferenceCreateInput) =>
    request<CharacterReference>(`/projects/${projectId}/character-references`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  creativeBrief: (projectId: string) =>
    request<CreativeBrief | null>(`/projects/${projectId}/creative-brief`),
  saveCreativeBrief: (projectId: string, body: CreativeBriefSaveInput) =>
    request<CreativeBrief>(`/projects/${projectId}/creative-brief`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  commercialBrief: (projectId: string) =>
    request<CommercialBrief | null>(`/projects/${projectId}/commercial-brief`),
  saveCommercialBrief: (projectId: string, body: CommercialBriefSaveInput) =>
    request<CommercialBrief>(`/projects/${projectId}/commercial-brief`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  commercialMaterials: (projectId: string) =>
    request<CommercialMaterial[]>(`/projects/${projectId}/commercial-materials`),
  uploadCommercialMaterial: async (
    projectId: string,
    file: File,
    rightsStatus: CommercialMaterial['rights_status'],
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('rights_status', rightsStatus);
    const response = await fetch(`${API_ROOT}/projects/${projectId}/commercial-materials`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok)
      throw new Error((await response.text()) || `Upload failed (${response.status})`);
    return response.json() as Promise<CommercialMaterial>;
  },
  commercialMaterialFileUrl: (projectId: string, materialId: string) =>
    `${API_ROOT}/projects/${projectId}/commercial-materials/${materialId}/file`,
  stages: (projectId: string) => request<StageState[]>(`/projects/${projectId}/stages`),
  manuscriptReleases: (projectId: string) =>
    request<ManuscriptRelease[]>(`/projects/${projectId}/manuscript-releases`),
  adaptationBranches: (projectId: string) =>
    request<AdaptationBranch[]>(`/projects/${projectId}/adaptation-branches`),
  adaptationOutlines: (projectId: string) =>
    request<AdaptationOutlineRelease[]>(`/projects/${projectId}/adaptation-outlines`),
  scriptReleases: (projectId: string) =>
    request<ScriptRelease[]>(`/projects/${projectId}/script-releases`),
  shotPlanReleases: (projectId: string) =>
    request<ShotPlanRelease[]>(`/projects/${projectId}/shot-plan-releases`),
  keyframeCandidates: (projectId: string) =>
    request<KeyframeCandidate[]>(`/projects/${projectId}/keyframe-candidates`),
  keyframeFileUrl: (projectId: string, candidateId: string) =>
    `${API_ROOT}/projects/${projectId}/keyframe-candidates/${candidateId}/file`,
  videoCandidates: (projectId: string) =>
    request<VideoCandidate[]>(`/projects/${projectId}/video-candidates`),
  audioCandidates: (projectId: string) =>
    request<AudioCandidate[]>(`/projects/${projectId}/audio-candidates`),
  videoFileUrl: (projectId: string, candidateId: string) =>
    `${API_ROOT}/projects/${projectId}/video-candidates/${candidateId}/file`,
  audioFileUrl: (projectId: string, candidateId: string) =>
    `${API_ROOT}/projects/${projectId}/audio-candidates/${candidateId}/file`,
  editPackages: (projectId: string) =>
    request<EditPackage[]>(`/projects/${projectId}/edit-packages`),
  editPackage: (projectId: string, packageId: string) =>
    request<EditPackage>(`/projects/${projectId}/edit-packages/${packageId}`),
  createEditPackage: (projectId: string) =>
    request<EditPackage>(`/projects/${projectId}/edit-packages`, { method: 'POST' }),
  deliveryRuntime: () => request<DeliveryRuntime>('/delivery/runtime'),
  deliveryMasters: (projectId: string) =>
    request<DeliveryMaster[]>(`/projects/${projectId}/delivery-masters`),
  renderDeliveryMaster: (projectId: string) =>
    request<DeliveryMaster>(`/projects/${projectId}/delivery-masters`, { method: 'POST' }),
  deliveryMasterFileUrl: (projectId: string, masterId: string) =>
    `${API_ROOT}/projects/${projectId}/delivery-masters/${masterId}/file`,
  updateEditPackageSubtitles: (projectId: string, packageId: string, srt: string) =>
    request<EditPackage>(`/projects/${projectId}/edit-packages/${packageId}/subtitles`, {
      method: 'PUT',
      body: JSON.stringify({ srt }),
    }),
  editPackageFileUrl: (projectId: string, packageId: string) =>
    `${API_ROOT}/projects/${projectId}/edit-packages/${packageId}/file`,
  jobs: (projectId: string) => request<GenerationJobSummary[]>(`/projects/${projectId}/jobs`),
  job: (projectId: string, jobId: string) =>
    request<GenerationJobSummary>(`/projects/${projectId}/jobs/${jobId}`),
  startStage: (projectId: string, stage: string) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(
      `/projects/${projectId}/stages/${stage}/start`,
      { method: 'POST' },
    ),
  createTextJob: (
    projectId: string,
    body: {
      stage_key: string;
      profile_id: string;
      idempotency_key: string;
      prompt: string;
      parameters: Record<string, unknown>;
      input_refs: string[];
      scope?: Record<string, string | number>;
      data_authorized: boolean;
    },
  ) =>
    request<{
      id: string;
      status: string;
      output?: {
        id: string;
        content_type: string;
        content: string;
        metadata: Record<string, unknown>;
      } | null;
      error?: Record<string, unknown>;
    }>(`/projects/${projectId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ ...body, modality: 'text' }),
    }),
  createImageJob: (
    projectId: string,
    body: {
      stage_key: string;
      profile_id: string;
      idempotency_key: string;
      prompt: string;
      parameters: Record<string, unknown>;
      input_refs: string[];
      scope: Record<string, string | number>;
      data_authorized: boolean;
    },
  ) =>
    request<{ id: string; status: string; error?: Record<string, unknown> }>(
      `/projects/${projectId}/jobs`,
      { method: 'POST', body: JSON.stringify({ ...body, modality: 'image' }) },
    ),
  createVideoJob: (
    projectId: string,
    body: {
      stage_key: string;
      profile_id: string;
      idempotency_key: string;
      prompt: string;
      parameters: Record<string, unknown>;
      input_refs: string[];
      scope: Record<string, string | number>;
      data_authorized: boolean;
    },
  ) =>
    request<{ id: string; status: string; error?: Record<string, unknown> }>(
      `/projects/${projectId}/jobs`,
      { method: 'POST', body: JSON.stringify({ ...body, modality: 'video' }) },
    ),
  createAudioJob: (
    projectId: string,
    body: {
      stage_key: string;
      profile_id: string;
      idempotency_key: string;
      prompt: string;
      parameters: Record<string, unknown>;
      input_refs: string[];
      scope: Record<string, string | number>;
      data_authorized: boolean;
    },
  ) =>
    request<{ id: string; status: string; error?: Record<string, unknown> }>(
      `/projects/${projectId}/jobs`,
      { method: 'POST', body: JSON.stringify({ ...body, modality: 'audio' }) },
    ),
  refreshVideoJob: (projectId: string, jobId: string) =>
    request<{
      id: string;
      status: string;
      error: Record<string, unknown>;
      video_candidate: {
        id: string;
        status: string;
        progress: number;
        error: Record<string, unknown>;
      };
    }>(`/projects/${projectId}/jobs/${jobId}/refresh`, { method: 'POST' }),
  updateJobOutput: (projectId: string, jobId: string, content: string, revision: number) =>
    request<{
      id: string;
      job_id: string;
      content_type: string;
      content: string;
      metadata: Record<string, unknown>;
      revision: number;
    }>(`/projects/${projectId}/jobs/${jobId}/output`, {
      method: 'PUT',
      body: JSON.stringify({ content, revision }),
    }),
  jobOutputVersions: (projectId: string, jobId: string) =>
    request<Array<{ revision: number; content: string; created_at: string }>>(
      `/projects/${projectId}/jobs/${jobId}/output/versions`,
    ),
  submitStageReview: (projectId: string, stage: string) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(
      `/projects/${projectId}/stages/${stage}/submit-review`,
      { method: 'POST' },
    ),
  decideStage: (
    projectId: string,
    stage: string,
    action: 'accept' | 'reject',
    reason?: string,
    risk_ack = false,
  ) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(
      `/projects/${projectId}/stages/${stage}/decision`,
      { method: 'POST', body: JSON.stringify({ action, reason, risk_ack }) },
    ),
  uploadChapters: async (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${API_ROOT}/projects/${projectId}/chapters/upload`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok)
      throw new Error((await response.text()) || `Upload failed (${response.status})`);
    return response.json() as Promise<ChapterImportResult>;
  },
  serviceProfiles: (projectId: string) =>
    request<ServiceProfile[]>(`/projects/${projectId}/service-profiles`),
  createServiceProfile: (
    projectId: string,
    body: Omit<ServiceProfile, 'id' | 'enabled' | 'version'> & {
      capabilities?: Record<string, unknown>;
    },
  ) =>
    request<ServiceProfile>(`/projects/${projectId}/service-profiles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testServiceProfile: (projectId: string, profileId: string) =>
    request<{
      status: 'connected';
      model_available: true;
      checked_at: string;
      execution_ready: true;
      message: string;
    }>(`/projects/${projectId}/service-profiles/${profileId}/test`, { method: 'POST' }),
};
