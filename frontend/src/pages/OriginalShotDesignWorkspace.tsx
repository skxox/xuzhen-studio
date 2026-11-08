import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Clapperboard, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StoryboardPlanEditor } from '../components/workspace/StoryboardPlanEditor';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project, ShotPlanRelease } from '../lib/types';

type ShotPlan = Omit<
  ShotPlanRelease,
  'id' | 'revision' | 'job_id' | 'shot_count' | 'created_at' | 'is_current'
>;
function parsePlan(raw?: string): ShotPlan | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'episodes' in value
      ? (value as ShotPlan)
      : null;
  } catch {
    return null;
  }
}

export function OriginalShotDesignWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; plan: ShotPlan } | null>(null);
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.stage_key === 'shotDesign' && j.status === 'running')
        ? 2500
        : false,
  });
  const branchesQuery = useQuery({
    queryKey: ['adaptation-branches', projectId],
    queryFn: () => api.adaptationBranches(projectId!),
    enabled: Boolean(projectId),
  });
  const outlineQuery = useQuery({
    queryKey: ['adaptation-outlines', projectId],
    queryFn: () => api.adaptationOutlines(projectId!),
    enabled: Boolean(projectId),
  });
  const scriptsQuery = useQuery({
    queryKey: ['script-releases', projectId],
    queryFn: () => api.scriptReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const releasesQuery = useQuery({
    queryKey: ['shot-plan-releases', projectId],
    queryFn: () => api.shotPlanReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === 'shotDesign');
  const currentScript = scriptsQuery.data?.find((item) => item.is_current);
  const branch = branchesQuery.data?.find((item) => item.id === currentScript?.branch_id);
  const outline = outlineQuery.data?.find((item) => item.id === currentScript?.outline_release_id);
  const jobs = jobsQuery.data ?? [];
  const scriptJobId = currentScript?.job_id ?? '';
  const characterJobId = currentScript?.character_job_id ?? '';
  const artJobId = currentScript?.art_job_id ?? '';
  const scriptJobQuery = useQuery({
    queryKey: ['job', projectId, scriptJobId],
    queryFn: () => api.job(projectId!, scriptJobId),
    enabled: Boolean(projectId && scriptJobId),
  });
  const characterQuery = useQuery({
    queryKey: ['job', projectId, characterJobId],
    queryFn: () => api.job(projectId!, characterJobId),
    enabled: Boolean(projectId && characterJobId),
  });
  const artQuery = useQuery({
    queryKey: ['job', projectId, artJobId],
    queryFn: () => api.job(projectId!, artJobId),
    enabled: Boolean(projectId && artJobId),
  });
  const profiles = (profilesQuery.data ?? []).filter(
    (p) => p.enabled && p.modality === 'text' && p.adapter_id === 'openai-compatible-chat',
  );
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const candidateJob = jobs.find((job) => job.stage_key === 'shotDesign');
  const candidate = parsePlan(candidateJob?.output?.content);
  const key = `${candidateJob?.id ?? ''}:${candidateJob?.output?.revision ?? 0}`;
  const plan = draft?.key === key ? draft.plan : candidate;
  const isEdited = Boolean(plan && candidate && JSON.stringify(plan) !== JSON.stringify(candidate));
  const review = stage?.status === 'needs_review' && Boolean(candidate);
  const accepted =
    stages.some((item) => item.stage_key === 'script' && item.status === 'accepted') &&
    Boolean(currentScript && outline?.is_current && branch);
  const running = stage?.status === 'running' || candidateJob?.status === 'running';
  const refresh = async () =>
    Promise.all(
      ['stages', 'jobs', 'shot-plan-releases'].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [queryKey, projectId] }),
      ),
    );
  const generate = useMutation({
    mutationFn: async () => {
      if (
        !projectId ||
        !currentScript ||
        !branch ||
        !outline ||
        !profile ||
        !scriptJobQuery.data?.output ||
        !characterQuery.data?.output ||
        !artQuery.data?.output
      )
        throw new Error('需要当前已验收剧本、改编大纲、角色和美术版本及文本模型。');
      const prompt = [
        '你是影视分镜师。根据已验收剧本为每一场设计可拍摄的镜头，严格输出 JSON，不要 Markdown。一个镜头可以覆盖多句连续对白，但每句对白必须恰好出现一次；镜头时长之和必须等于该场动作秒数加全部对白秒数。逐集逐场覆盖全部输入。镜头需明确景别、角度、运动、构图、可见动作、角色、素材、对白编号、时长、章节出处、连续性锚点、视觉提示词、负面提示词和转场。角色只能来自当前场景；章节出处逐镜继承大纲，不得编造。提示词须适合后续图像/视频生成，写明人物外观与场景连续性。',
        `结构：{branch_id,script_release_id,character_job_id,art_job_id,episode_count,episodes:[{episode_number,scenes:[{scene_number,shots:[{shot_number,shot_size, camera_angle,camera_movement,composition,visible_action,character_names,asset_refs,dialogue_numbers,duration_seconds,source_chapter_ordinals,continuity_anchors,visual_prompt,negative_prompt,transition}]}]}]}`,
        `版本引用：${JSON.stringify({ branch_id: branch.id, script_release_id: currentScript.id, character_job_id: characterJobId, art_job_id: artJobId, episode_count: currentScript.episode_count })}`,
        `已验收大纲：${JSON.stringify(outline.episodes)}`,
        `已验收剧本：${scriptJobQuery.data.output.content}`,
        `角色圣经：${characterQuery.data.output.content}`,
        `美术设定：${artQuery.data.output.content}`,
      ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('当前分镜上下文过长，请缩小集数范围或精简资产设定后再生成。');
      if (stage?.status !== 'running') await api.startStage(projectId, 'shotDesign');
      idempotencyKey.current = crypto.randomUUID();
      return api.createTextJob(projectId, {
        stage_key: 'shotDesign',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt,
        parameters: { temperature: 0.35, max_tokens: 24000 },
        input_refs: [branch.id, outline.id, currentScript.id, characterJobId, artJobId],
        scope: {
          branch_id: branch.id,
          outline_release_id: outline.id,
          script_release_id: currentScript.id,
          character_job_id: characterJobId,
          art_job_id: artJobId,
          episode_count: currentScript.episode_count,
        },
        data_authorized: consent,
      });
    },
    onSuccess: async () => {
      setConsent(false);
      await refresh();
    },
    onError: refresh,
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        projectId!,
        candidateJob!.id,
        JSON.stringify(plan),
        candidateJob!.output!.revision ?? 1,
      ),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        projectId!,
        'shotDesign',
        action,
        action === 'reject' ? reason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReason('');
      await refresh();
    },
  });
  const showError = generate.error ?? save.error ?? decide.error;
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="STORYBOARD · ORIGINAL"
        title="镜头设计"
        description="AI 从已验收剧本提出逐场镜头方案；你可以审阅结构化镜头、调整生成提示词，并冻结为下游关键帧输入。"
      />
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">上游版本门禁</span>
            <h2>当前制作基线</h2>
          </div>
          <Link className="text-link" to="/writing/script">
            查看分集剧本 <ArrowRight size={15} />
          </Link>
        </div>
        <p>
          {accepted
            ? `分支 ${branch?.revision} · 剧本 R${currentScript?.revision} · ${currentScript?.episode_count} 集 · ${outline?.episode_count} 集大纲`
            : '需要先验收分集剧本、大纲、角色与美术版本。'}
        </p>
        {!accepted && (
          <div className="gate-list">
            <Link to="/writing/script">
              前往剧本阶段完成验收 <ArrowRight size={15} />
            </Link>
          </div>
        )}
        {accepted && (
          <div className="form-grid">
            <Field label="文本模型">
              <select value={profile?.id ?? ''} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">选择已启用的文本模型</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model_id}
                  </option>
                ))}
              </select>
            </Field>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              我确认本次会将锁定剧本、角色和美术上下文发送给所选服务
            </label>
            <Button
              variant="primary"
              icon={<Sparkles size={16} />}
              disabled={!profile || !consent || running || review || stage?.status === 'accepted'}
              onClick={() => generate.mutate()}
            >
              {running ? '正在生成镜头方案…' : 'AI 生成分镜候选'}
            </Button>
          </div>
        )}
        {showError && <p className="form-error">{showError.message}</p>}
      </Panel>
      {plan && (
        <Panel>
          <div className="workspace-section-heading">
            <div>
              <span className="eyebrow">AI 候选 · 可编辑 JSON</span>
              <h2>
                {plan.episode_count} 集 ·{' '}
                {plan.episodes.reduce(
                  (n, ep) => n + ep.scenes.reduce((m, scene) => m + scene.shots.length, 0),
                  0,
                )}{' '}
                个镜头
              </h2>
            </div>
            <span className="status-pill">
              {stage?.status === 'accepted' ? '已验收冻结' : review ? '等待人工审核' : '草稿'}
            </span>
          </div>
          <p>
            逐镜调整景别、机位、运镜、构图、动作、对白分配、连续性锚点和生成提示词。章节出处与素材引用从已验收上游继承。保存时服务端会校验对白覆盖、时长、角色边界和章节出处。
          </p>
          <fieldset className="shot-plan-fieldset" disabled={stage?.status === 'accepted'}>
            <StoryboardPlanEditor
              episodes={plan.episodes}
              onChange={(episodes) => setDraft({ key, plan: { ...plan, episodes } })}
            />
          </fieldset>
          <div className="workspace-actions">
            {isEdited && stage?.status !== 'accepted' && (
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                保存并校验编辑
              </Button>
            )}
            {review && (
              <>
                <Field label="退回原因">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="退回修改时说明具体问题"
                  />
                </Field>
                <Button onClick={() => decide.mutate('reject')} disabled={!reason.trim()}>
                  退回修改
                </Button>
                <Button
                  variant="primary"
                  icon={<Check size={16} />}
                  onClick={() => decide.mutate('accept')}
                >
                  验收并冻结分镜版本
                </Button>
              </>
            )}
          </div>
        </Panel>
      )}
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">IMMUTABLE RELEASES</span>
            <h2>已验收分镜版本</h2>
          </div>
        </div>
        {(releasesQuery.data ?? []).length === 0 ? (
          <p>暂无已验收版本。验收后会在此保留可追溯快照。</p>
        ) : (
          <div className="release-list">
            {releasesQuery.data?.map((release) => (
              <details key={release.id} className="release-card">
                <summary>
                  R{release.revision} · {release.episode_count} 集 · {release.shot_count} 镜{' '}
                  {release.is_current ? '· 当前版本' : ''}
                </summary>
                <pre>{JSON.stringify(release.episodes, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">NEXT GATE</span>
            <h2>关键帧生成</h2>
          </div>
          <Clapperboard size={18} />
        </div>
        <p>分镜版本验收后，镜头可作为图像生成任务输入。关键帧与镜头绑定后再进入视频片段生成。</p>
      </Panel>
    </div>
  );
}
