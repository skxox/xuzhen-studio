import type { ApiHealth, Chapter, ChapterImportResult, CharacterReference, CharacterReferenceCreateInput, CommercialBrief, CommercialBriefSaveInput, CommercialMaterial, CreativeBrief, CreativeBriefSaveInput, GenerationJobSummary, Project, ProjectCreateInput, ServiceProfile, StageState } from './types';

const API_ROOT = import.meta.env.VITE_API_ROOT ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<ApiHealth>('/health'),
  projects: () => request<Project[]>('/projects'),
  createProject: (body: ProjectCreateInput) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProjectRights: (projectId: string, rights_status: Project['rights_status']) =>
    request<Project>(`/projects/${projectId}/rights`, { method: 'PATCH', body: JSON.stringify({ rights_status }) }),
  chapters: (projectId: string) => request<Chapter[]>(`/projects/${projectId}/chapters`),
  reviseChapter: (projectId: string, chapterId: string, body: Pick<Chapter, 'title' | 'body'>) =>
    request<Pick<Chapter, 'id' | 'ordinal' | 'title' | 'content_hash' | 'version'>>(`/projects/${projectId}/chapters/${chapterId}`, { method: 'PUT', body: JSON.stringify(body) }),
  chapterVersions: (projectId: string, chapterId: string) =>
    request<Chapter[]>(`/projects/${projectId}/chapters/${chapterId}/versions`),
  restoreChapterVersion: (projectId: string, chapterId: string, version: number) =>
    request<Pick<Chapter, 'id' | 'ordinal' | 'title' | 'content_hash' | 'version'>>(`/projects/${projectId}/chapters/${chapterId}/restore`, { method: 'POST', body: JSON.stringify({ version }) }),
  characterReferences: (projectId: string) => request<CharacterReference[]>(`/projects/${projectId}/character-references`),
  createCharacterReference: (projectId: string, body: CharacterReferenceCreateInput) =>
    request<CharacterReference>(`/projects/${projectId}/character-references`, { method: 'POST', body: JSON.stringify(body) }),
  creativeBrief: (projectId: string) => request<CreativeBrief | null>(`/projects/${projectId}/creative-brief`),
  saveCreativeBrief: (projectId: string, body: CreativeBriefSaveInput) =>
    request<CreativeBrief>(`/projects/${projectId}/creative-brief`, { method: 'PUT', body: JSON.stringify(body) }),
  commercialBrief: (projectId: string) => request<CommercialBrief | null>(`/projects/${projectId}/commercial-brief`),
  saveCommercialBrief: (projectId: string, body: CommercialBriefSaveInput) =>
    request<CommercialBrief>(`/projects/${projectId}/commercial-brief`, { method: 'PUT', body: JSON.stringify(body) }),
  commercialMaterials: (projectId: string) => request<CommercialMaterial[]>(`/projects/${projectId}/commercial-materials`),
  uploadCommercialMaterial: async (projectId: string, file: File, rightsStatus: CommercialMaterial['rights_status']) => {
    const form = new FormData(); form.append('file', file); form.append('rights_status', rightsStatus);
    const response = await fetch(`${API_ROOT}/projects/${projectId}/commercial-materials`, { method: 'POST', body: form });
    if (!response.ok) throw new Error((await response.text()) || `Upload failed (${response.status})`);
    return response.json() as Promise<CommercialMaterial>;
  },
  commercialMaterialFileUrl: (projectId: string, materialId: string) => `${API_ROOT}/projects/${projectId}/commercial-materials/${materialId}/file`,
  stages: (projectId: string) => request<StageState[]>(`/projects/${projectId}/stages`),
  jobs: (projectId: string) => request<GenerationJobSummary[]>(`/projects/${projectId}/jobs`),
  startStage: (projectId: string, stage: string) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(`/projects/${projectId}/stages/${stage}/start`, { method: 'POST' }),
  createTextJob: (projectId: string, body: { stage_key: string; profile_id: string; idempotency_key: string; prompt: string; parameters: Record<string, unknown>; input_refs: string[]; data_authorized: boolean }) =>
    request<{ id: string; status: string; output?: { id: string; content_type: string; content: string; metadata: Record<string, unknown> } | null; error?: Record<string, unknown> }>(`/projects/${projectId}/jobs`, { method: 'POST', body: JSON.stringify({ ...body, modality: 'text' }) }),
  updateJobOutput: (projectId: string, jobId: string, content: string, revision: number) =>
    request<{ id: string; job_id: string; content_type: string; content: string; metadata: Record<string, unknown>; revision: number }>(`/projects/${projectId}/jobs/${jobId}/output`, { method: 'PUT', body: JSON.stringify({ content, revision }) }),
  jobOutputVersions: (projectId: string, jobId: string) =>
    request<Array<{ revision: number; content: string; created_at: string }>>(`/projects/${projectId}/jobs/${jobId}/output/versions`),
  submitStageReview: (projectId: string, stage: string) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(`/projects/${projectId}/stages/${stage}/submit-review`, { method: 'POST' }),
  decideStage: (projectId: string, stage: string, action: 'accept' | 'reject', reason?: string) =>
    request<Pick<StageState, 'id' | 'stage_key' | 'status' | 'version'>>(`/projects/${projectId}/stages/${stage}/decision`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
  uploadChapters: async (projectId: string, file: File) => {
    const form = new FormData(); form.append('file', file);
    const response = await fetch(`${API_ROOT}/projects/${projectId}/chapters/upload`, { method: 'POST', body: form });
    if (!response.ok) throw new Error((await response.text()) || `Upload failed (${response.status})`);
    return response.json() as Promise<ChapterImportResult>;
  },
  serviceProfiles: (projectId: string) => request<ServiceProfile[]>(`/projects/${projectId}/service-profiles`),
  createServiceProfile: (projectId: string, body: Omit<ServiceProfile, 'id' | 'enabled' | 'version'> & { capabilities?: Record<string, unknown> }) =>
    request<ServiceProfile>(`/projects/${projectId}/service-profiles`, { method: 'POST', body: JSON.stringify(body) }),
  testServiceProfile: (projectId: string, profileId: string) =>
    request<{ status: 'connected'; model_available: true; checked_at: string; execution_ready: true; message: string }>(`/projects/${projectId}/service-profiles/${profileId}/test`, { method: 'POST' }),
};
