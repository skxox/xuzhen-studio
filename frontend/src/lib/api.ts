import type { ApiHealth, Chapter, ChapterImportResult, Project, ProjectCreateInput, ServiceProfile } from './types';

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
  chapters: (projectId: string) => request<Chapter[]>(`/projects/${projectId}/chapters`),
  uploadChapters: async (projectId: string, file: File) => {
    const form = new FormData(); form.append('file', file);
    const response = await fetch(`${API_ROOT}/projects/${projectId}/chapters/upload`, { method: 'POST', body: form });
    if (!response.ok) throw new Error((await response.text()) || `Upload failed (${response.status})`);
    return response.json() as Promise<ChapterImportResult>;
  },
  serviceProfiles: (projectId: string) => request<ServiceProfile[]>(`/projects/${projectId}/service-profiles`),
  createServiceProfile: (projectId: string, body: Omit<ServiceProfile, 'id' | 'enabled' | 'version'> & { capabilities?: Record<string, unknown> }) =>
    request<ServiceProfile>(`/projects/${projectId}/service-profiles`, { method: 'POST', body: JSON.stringify(body) }),
};
