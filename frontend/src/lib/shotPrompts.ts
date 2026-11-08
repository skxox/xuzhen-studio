import type { GenerationJobSummary } from './types';

type ShotAddress = {
  episode_number: number;
  scene_number: number;
  shot_number: number;
};

export function persistedShotPrompt(
  jobs: GenerationJobSummary[] | undefined,
  stageKey: string,
  shotPlanReleaseId: string | undefined,
  shot: ShotAddress | undefined,
): string | undefined {
  if (!jobs || !shotPlanReleaseId || !shot) return undefined;
  const matchingJob = jobs.find((job) => {
    if (job.stage_key !== stageKey) return false;
    const scope = job.input_snapshot.scope;
    if (!isRecord(scope)) return false;
    return (
      scope.shot_plan_release_id === shotPlanReleaseId &&
      scope.episode_number === shot.episode_number &&
      scope.scene_number === shot.scene_number &&
      scope.shot_number === shot.shot_number
    );
  });
  const prompt = matchingJob?.input_snapshot.prompt;
  return typeof prompt === 'string' ? prompt : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
