import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { persistedShotPrompt } from '../lib/shotPrompts';
import { useShotPromptDrafts } from '../lib/useShotPromptDrafts';
import type { Project, ShotPlanRelease } from '../lib/types';

type Shot = ShotPlanRelease['episodes'][number]['scenes'][number]['shots'][number];
type ShotRef = { episode_number: number; scene_number: number; shot_number: number; shot: Shot };

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
}

function refKey(ref: Pick<ShotRef, 'episode_number' | 'scene_number' | 'shot_number'>) {
  return `${ref.episode_number}:${ref.scene_number}:${ref.shot_number}`;
}

function promptDraftKey(planId: string | undefined, shotKey: string) {
  return planId && shotKey ? `${planId}:${shotKey}` : '';
}

export function OriginalKeyframesWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [promptDrafts, setPromptDrafts] = useShotPromptDrafts(projectId, 'keyframes');
  const [size, setSize] = useState('1024x1024');
  const [reason, setReason] = useState('');
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.stage_key === 'keyframes' && job.status === 'running')
        ? 2500
        : false,
  });
  const plansQuery = useQuery({
    queryKey: ['shot-plan-releases', projectId],
    queryFn: () => api.shotPlanReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const candidatesQuery = useQuery({
    queryKey: ['keyframe-candidates', projectId],
    queryFn: () => api.keyframeCandidates(projectId!),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === 'keyframes');
  const plan = plansQuery.data?.find((item) => item.is_current);
  const candidates = candidatesQuery.data ?? [];
  const profiles = (profilesQuery.data ?? []).filter(
    (item) =>
      item.modality === 'image' && item.adapter_id === 'openai-compatible-image' && item.enabled,
  );
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0];
  const shots = useMemo<ShotRef[]>(
    () =>
      plan?.episodes.flatMap((episode) =>
        episode.scenes.flatMap((scene) =>
          scene.shots.map((shot) => ({
            episode_number: episode.episode_number,
            scene_number: scene.scene_number,
            shot_number: shot.shot_number,
            shot,
          })),
        ),
      ) ?? [],
    [plan],
  );
  const accepted = new Set(
    candidates
      .filter((item) => item.status === 'accepted' && item.shot_plan_release_id === plan?.id)
      .map((item) => `${item.episode_number}:${item.scene_number}:${item.shot_number}`),
  );
  const pending = candidates.find(
    (item) => item.status === 'needs_review' && item.shot_plan_release_id === plan?.id,
  );
  const pendingRef = shots.find((item) => refKey(item) === (pending ? refKey(pending) : ''));
  const firstUnaccepted = shots.find((item) => !accepted.has(refKey(item)));
  const requested = shots.find((item) => refKey(item) === selectedKey);
  const focus = pendingRef ?? requested ?? firstUnaccepted ?? shots[0];
  const currentKey = focus ? refKey(focus) : '';
  const currentDraftKey = promptDraftKey(plan?.id, currentKey);
  const currentPromptDraft = promptDrafts[currentDraftKey];
  const persistedPrompt = persistedShotPrompt(jobsQuery.data, 'keyframes', plan?.id, focus);
  const savedCandidate = candidates.find(
    (item) =>
      refKey(item) === currentKey &&
      item.shot_plan_release_id === plan?.id &&
      item.status !== 'superseded',
  );
  const currentCandidate =
    pending ??
    (focus
      ? candidates.find(
          (item) =>
            refKey(item) === currentKey &&
            item.status === 'accepted' &&
            item.shot_plan_release_id === plan?.id,
        )
      : undefined);
  const savedPrompt = persistedPrompt ?? savedCandidate?.prompt;
  const prompt =
    currentPromptDraft !== undefined
      ? currentPromptDraft
      : (savedPrompt ??
        (focus ? `${focus.shot.visual_prompt}\n\nAvoid: ${focus.shot.negative_prompt}` : ''));
  const running =
    stage?.status === 'running' ||
    (jobsQuery.data ?? []).some((job) => job.stage_key === 'keyframes' && job.status === 'running');
  const stageReady = Boolean(
    plan && stages.find((item) => item.stage_key === 'shotDesign')?.status === 'accepted',
  );
  const refresh = async () =>
    Promise.all(
      ['stages', 'jobs', 'keyframe-candidates'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, projectId] }),
      ),
    );
  const generate = useMutation({
    mutationFn: async ({ prompt: submittedPrompt }: { draftKey: string; prompt: string }) => {
      if (!projectId || !plan || !focus || !profile)
        throw new Error('需要已验收的分镜镜头和可用图片模型。');
      if (!submittedPrompt.trim()) throw new Error('生成提示词不能为空。');
      if (stage?.status === 'needs_review') throw new Error('请先处理当前等待审核的关键帧。');
      const basePromptHash = await sha256(focus.shot.visual_prompt);
      if (stage?.status !== 'running') await api.startStage(projectId, 'keyframes');
      idempotencyKey.current = crypto.randomUUID();
      return api.createImageJob(projectId, {
        stage_key: 'keyframes',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt: submittedPrompt.trim(),
        parameters: { size },
        input_refs: [
          plan.id,
          plan.job_id,
          plan.script_release_id,
          plan.character_job_id,
          plan.art_job_id,
        ],
        scope: {
          shot_plan_release_id: plan.id,
          episode_number: focus.episode_number,
          scene_number: focus.scene_number,
          shot_number: focus.shot_number,
          base_prompt_hash: basePromptHash,
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
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        projectId!,
        'keyframes',
        action,
        action === 'reject' ? reason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReason('');
      setSelectedKey('');
      await refresh();
    },
  });
  const error = generate.error ?? decide.error;
  const failedJob = (jobsQuery.data ?? []).find(
    (item) => item.stage_key === 'keyframes' && ['failed', 'blocked'].includes(item.status),
  );
  const jobError = failedJob?.error?.message ?? failedJob?.error?.code;
  const reviewCandidate = currentCandidate;
  const canRegenerateSelected = selectedKey === currentKey && accepted.has(currentKey);
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="KEYFRAMES · ORIGINAL"
        title="关键帧生成与审阅"
        description="以已验收分镜为冻结输入，逐镜生成关键帧。每张图单独审阅；视频阶段只有在当前分镜的全部镜头都有验收关键帧后才能启动。"
      />
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">IMAGE PROVIDER</span>
            <h2>生成设置</h2>
          </div>
          <Link className="text-link" to="/settings">
            管理图片服务
          </Link>
        </div>
        {!stageReady && (
          <p>
            请先完成逐镜分镜验收。<Link to="/writing/storyboard">前往镜头设计</Link>
          </p>
        )}
        {stageReady && (
          <div className="form-grid">
            <Field label="图片模型">
              <select
                value={profile?.id ?? ''}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="">选择已连通的 OpenAI 兼容图片模型</option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.model_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="画面尺寸">
              <select value={size} onChange={(event) => setSize(event.target.value)}>
                <option value="1024x1024">1024 × 1024</option>
                <option value="1536x1024">1536 × 1024（横向）</option>
                <option value="1024x1536">1024 × 1536（纵向）</option>
              </select>
            </Field>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              我确认将当前镜头提示词发送给所选图片 API
            </label>
          </div>
        )}
        {error && <p className="form-error">{error.message}</p>}
        {typeof jobError === 'string' && <p className="form-error">上次生成未完成：{jobError}</p>}
      </Panel>
      {stageReady && plan && (
        <div className="keyframe-workbench">
          <Panel className="keyframe-shot-list">
            <div className="workspace-section-heading">
              <div>
                <span className="eyebrow">SHOT COVERAGE</span>
                <h2>镜头清单</h2>
              </div>
              <span>
                {accepted.size}/{shots.length}
              </span>
            </div>
            {plan.episodes.map((episode) => (
              <section key={episode.episode_number}>
                <h3>第 {episode.episode_number} 集</h3>
                {episode.scenes.map((scene) => (
                  <div key={scene.scene_number}>
                    <h4>第 {scene.scene_number} 场</h4>
                    {scene.shots.map((shot) => {
                      const ref = {
                        episode_number: episode.episode_number,
                        scene_number: scene.scene_number,
                        shot_number: shot.shot_number,
                      };
                      const key = refKey(ref);
                      const done = accepted.has(key);
                      const needsReview = pending && refKey(pending) === key;
                      return (
                        <button
                          type="button"
                          className={`keyframe-shot ${key === currentKey ? 'is-selected' : ''}`}
                          key={key}
                          onClick={() => {
                            setSelectedKey(key);
                          }}
                        >
                          <span>{done ? '✓' : needsReview ? '◷' : '○'}</span>
                          <b>镜头 {shot.shot_number}</b>
                          <small>
                            {shot.shot_size} · {shot.duration_seconds}s
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            ))}
          </Panel>
          <div className="keyframe-detail">
            <Panel>
              <div className="workspace-section-heading">
                <div>
                  <span className="eyebrow">
                    SHOT{' '}
                    {focus
                      ? `${focus.episode_number}.${focus.scene_number}.${focus.shot_number}`
                      : '—'}
                  </span>
                  <h2>{focus?.shot.visible_action ?? '无镜头'}</h2>
                </div>
                <span className="status-pill">
                  {pending ? '等待审核' : currentCandidate ? '已验收' : '待生成'}
                </span>
              </div>
              {focus && (
                <>
                  <p>
                    对白编号：
                    {focus.shot.dialogue_numbers.map((number) => `#${number}`).join(' · ') || '无'}
                    {' · '}章节出处：{focus.shot.source_chapter_ordinals.join('、') || '原创场次'}
                  </p>
                  <Field
                    label="生成提示词"
                    hint={
                      currentPromptDraft !== undefined && currentPromptDraft !== savedPrompt
                        ? '未提交的本地草稿；切换镜头、离开页面或刷新后仍保留在当前标签页。'
                        : savedPrompt
                          ? '当前显示最近生成任务保存的提示词；修改后会成为本地草稿。'
                          : '允许为本次关键帧覆盖分镜提示词；分镜版本本身不会被修改。'
                    }
                  >
                    <textarea
                      rows={7}
                      value={prompt}
                      disabled={Boolean(pending) || running}
                      onChange={(event) =>
                        setPromptDrafts((drafts) => ({
                          ...drafts,
                          [currentDraftKey]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  {reviewCandidate && (
                    <img
                      className="keyframe-preview"
                      src={api.keyframeFileUrl(projectId!, reviewCandidate.id)}
                      alt={`第${reviewCandidate.episode_number}集第${reviewCandidate.scene_number}场镜头${reviewCandidate.shot_number}关键帧`}
                    />
                  )}
                  {focus &&
                    candidates.filter(
                      (item) =>
                        refKey(item) === currentKey && item.shot_plan_release_id === plan?.id,
                    ).length > 0 && (
                      <details className="keyframe-history">
                        <summary>该镜头的候选历史</summary>
                        {candidates
                          .filter(
                            (item) =>
                              refKey(item) === currentKey && item.shot_plan_release_id === plan?.id,
                          )
                          .map((item) => (
                            <article key={item.id}>
                              <img
                                src={api.keyframeFileUrl(projectId!, item.id)}
                                alt={`候选 ${item.id}`}
                              />
                              <div>
                                <b>
                                  {item.status === 'accepted'
                                    ? '已验收'
                                    : item.status === 'superseded'
                                      ? '已替换'
                                      : item.status === 'rejected'
                                        ? '已退回'
                                        : '待审核'}
                                </b>
                                <small>{new Date(item.created_at).toLocaleString()}</small>
                                <code>{item.sha256.slice(0, 12)}</code>
                              </div>
                            </article>
                          ))}
                      </details>
                    )}
                  <div className="workspace-actions">
                    {!pending && (
                      <Button
                        variant="primary"
                        icon={
                          accepted.has(currentKey) ? (
                            <RefreshCw size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )
                        }
                        disabled={
                          !profile ||
                          !consent ||
                          running ||
                          (accepted.size === shots.length && !canRegenerateSelected)
                        }
                        onClick={() => generate.mutate({ draftKey: currentDraftKey, prompt })}
                      >
                        {accepted.has(currentKey) ? '重新生成此镜头' : '生成关键帧'}
                      </Button>
                    )}
                    {pending && (
                      <>
                        <Field label="退回原因">
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="指出需要修正的内容"
                          />
                        </Field>
                        <Button onClick={() => decide.mutate('reject')} disabled={!reason.trim()}>
                          退回重做
                        </Button>
                        <Button
                          variant="primary"
                          icon={<Check size={16} />}
                          onClick={() => decide.mutate('accept')}
                        >
                          验收这张关键帧
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </Panel>
          </div>
        </div>
      )}
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">NEXT GATE</span>
            <h2>视频生成门禁</h2>
          </div>
          <ImagePlus size={18} />
        </div>
        <p>
          当前镜头关键帧已验收 {accepted.size} / {shots.length}
          。所有镜头齐备后，逐镜视频生成才能启动。
        </p>
        {stage?.status === 'accepted' && accepted.size === shots.length && (
          <p className="success-copy">关键帧覆盖完整，可以进入逐镜视频阶段。</p>
        )}
      </Panel>
    </div>
  );
}
