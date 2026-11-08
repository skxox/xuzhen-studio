import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clapperboard, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project, ShotPlanRelease, VideoCandidate } from '../lib/types';

type Shot = ShotPlanRelease['episodes'][number]['scenes'][number]['shots'][number];
type ShotRef = { episode_number: number; scene_number: number; shot_number: number; shot: Shot };
type PromptDrafts = Record<string, string>;
const keyOf = (shot: Pick<ShotRef, 'episode_number' | 'scene_number' | 'shot_number'>) =>
  `${shot.episode_number}:${shot.scene_number}:${shot.shot_number}`;
const promptDraftKey = (planId: string | undefined, shotKey: string) =>
  planId && shotKey ? `${planId}:${shotKey}` : '';

export function OriginalVideoWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const client = useQueryClient();
  const idempotency = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [promptDrafts, setPromptDrafts] = useState<PromptDrafts>({});
  const [seconds, setSeconds] = useState(6);
  const [size, setSize] = useState('1280x720');
  const [reason, setReason] = useState('');
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const plansQuery = useQuery({
    queryKey: ['shot-plan-releases', projectId],
    queryFn: () => api.shotPlanReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const framesQuery = useQuery({
    queryKey: ['keyframe-candidates', projectId],
    queryFn: () => api.keyframeCandidates(projectId!),
    enabled: Boolean(projectId),
  });
  const candidatesQuery = useQuery({
    queryKey: ['video-candidates', projectId],
    queryFn: async () => {
      const rows = await api.videoCandidates(projectId!);
      const running = rows.find((row) => ['queued', 'processing'].includes(row.status));
      if (running) await api.refreshVideoJob(projectId!, running.job_id);
      return api.videoCandidates(projectId!);
    },
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.some((row) => ['queued', 'processing'].includes(row.status)) ? 2500 : false,
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((row) => row.stage_key === 'video');
  const plan = plansQuery.data?.find((row) => row.is_current);
  const frames = framesQuery.data ?? [];
  const candidates = candidatesQuery.data ?? [];
  const profiles = (profilesQuery.data ?? []).filter(
    (item) =>
      item.modality === 'video' && item.adapter_id === 'openai-compatible-video' && item.enabled,
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
  const acceptedFrames = new Map(
    frames
      .filter((item) => item.status === 'accepted' && item.shot_plan_release_id === plan?.id)
      .map((item) => [keyOf(item), item]),
  );
  const acceptedVideos = new Set(
    candidates
      .filter((item) => item.status === 'accepted' && item.shot_plan_release_id === plan?.id)
      .map(keyOf),
  );
  const pending = candidates.find(
    (item) => item.status === 'needs_review' && item.shot_plan_release_id === plan?.id,
  );
  const inProgress = candidates.find(
    (item) =>
      ['queued', 'processing'].includes(item.status) && item.shot_plan_release_id === plan?.id,
  );
  const focus =
    shots.find(
      (shot) => keyOf(shot) === (pending ? keyOf(pending) : inProgress ? keyOf(inProgress) : ''),
    ) ??
    shots.find((shot) => keyOf(shot) === selectedKey) ??
    shots.find((shot) => !acceptedVideos.has(keyOf(shot))) ??
    shots[0];
  const currentKey = focus ? keyOf(focus) : '';
  const currentDraftKey = promptDraftKey(plan?.id, currentKey);
  const currentPromptDraft = promptDrafts[currentDraftKey];
  const keyframe = focus ? acceptedFrames.get(currentKey) : undefined;
  const prompt =
    currentPromptDraft !== undefined
      ? currentPromptDraft
      : focus
        ? `${focus.shot.visual_prompt}\n\nMotion: ${focus.shot.visible_action}. Camera: ${focus.shot.camera_movement}. Transition: ${focus.shot.transition}.\n\nAvoid: ${focus.shot.negative_prompt}`
        : '';
  const running =
    stage?.status === 'running' ||
    candidates.some((item) => ['queued', 'processing'].includes(item.status));
  const ready = Boolean(
    plan && stages.find((row) => row.stage_key === 'keyframes')?.status === 'accepted',
  );
  const refresh = async () =>
    Promise.all(
      ['stages', 'jobs', 'video-candidates'].map((key) =>
        client.invalidateQueries({ queryKey: [key, projectId] }),
      ),
    );
  const generate = useMutation({
    mutationFn: async ({ prompt: submittedPrompt }: { draftKey: string; prompt: string }) => {
      if (!projectId || !plan || !focus || !keyframe || !profile)
        throw new Error('需要已验收分镜、对应关键帧和可用视频 API。');
      if (!submittedPrompt.trim()) throw new Error('视频提示词不能为空。');
      if (pending) throw new Error('请先审阅当前视频候选。');
      if (stage?.status !== 'running') await api.startStage(projectId, 'video');
      idempotency.current = crypto.randomUUID();
      return api.createVideoJob(projectId, {
        stage_key: 'video',
        profile_id: profile.id,
        idempotency_key: idempotency.current,
        prompt: submittedPrompt.trim(),
        parameters: { seconds, size },
        input_refs: [
          plan.id,
          plan.job_id,
          plan.script_release_id,
          plan.character_job_id,
          plan.art_job_id,
          keyframe.id,
        ],
        scope: {
          shot_plan_release_id: plan.id,
          keyframe_candidate_id: keyframe.id,
          episode_number: focus.episode_number,
          scene_number: focus.scene_number,
          shot_number: focus.shot_number,
        },
        data_authorized: consent,
      });
    },
    onSuccess: async (_result, { draftKey }) => {
      setConsent(false);
      setPromptDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[draftKey];
        return nextDrafts;
      });
      await refresh();
    },
    onError: refresh,
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(projectId!, 'video', action, action === 'reject' ? reason.trim() : undefined),
    onSuccess: async () => {
      setReason('');
      setSelectedKey('');
      await refresh();
    },
  });
  const error = generate.error ?? decide.error ?? candidatesQuery.error;
  const failedCandidate = candidates.find(
    (item) =>
      item.status === 'failed' &&
      item.shot_plan_release_id === plan?.id &&
      focus &&
      keyOf(item) === keyOf(focus),
  );
  const currentCandidate: VideoCandidate | undefined =
    pending ??
    candidates.find(
      (item) =>
        item.status === 'accepted' &&
        keyOf(item) === currentKey &&
        item.shot_plan_release_id === plan?.id,
    );
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="VIDEO · ORIGINAL"
        title="逐镜视频生成与审片"
        description="每条视频任务引用对应的已验收关键帧。任务异步运行，完成后逐镜审片；全部镜头验收后才能进入成片合成。"
      />
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">VIDEO PROVIDER</span>
            <h2>生成设置</h2>
          </div>
          <Link className="text-link" to="/settings">
            管理视频服务
          </Link>
        </div>
        {!ready && (
          <p>
            先完成分镜和全部关键帧验收。<Link to="/writing/keyframes">前往关键帧</Link>
          </p>
        )}
        {ready && (
          <div className="form-grid">
            <Field label="视频模型">
              <select
                value={profile?.id ?? ''}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="">选择已启用的 OpenAI-compatible Video 服务</option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.model_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="时长">
              <select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>
                {[4, 6, 8, 12].map((value) => (
                  <option key={value} value={value}>
                    {value} 秒
                  </option>
                ))}
              </select>
            </Field>
            <Field label="输出尺寸">
              <select value={size} onChange={(event) => setSize(event.target.value)}>
                <option value="1280x720">16:9 · 1280×720</option>
                <option value="720x1280">9:16 · 720×1280</option>
                <option value="1024x1024">1:1 · 1024×1024</option>
              </select>
            </Field>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              我确认将提示词和已验收关键帧发送给所选视频 API
            </label>
          </div>
        )}
        {error && <p className="form-error">{error.message}</p>}
        {failedCandidate && (
          <p className="form-error">
            本镜头上次任务失败：
            {String(failedCandidate.error.message ?? failedCandidate.error.code ?? '视频服务失败')}
            。可以调整提示词后单镜重试。
          </p>
        )}
      </Panel>
      {ready && plan && (
        <div className="keyframe-workbench">
          <Panel className="keyframe-shot-list">
            <div className="workspace-section-heading">
              <div>
                <span className="eyebrow">SHOT COVERAGE</span>
                <h2>镜头清单</h2>
              </div>
              <span>
                {acceptedVideos.size}/{shots.length}
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
                      const status = candidates.find(
                        (item) =>
                          keyOf(item) === keyOf(ref) && item.shot_plan_release_id === plan.id,
                      )?.status;
                      return (
                        <button
                          type="button"
                          className={`keyframe-shot ${keyOf(ref) === currentKey ? 'is-selected' : ''}`}
                          key={keyOf(ref)}
                          onClick={() => {
                            setSelectedKey(keyOf(ref));
                          }}
                        >
                          <span>
                            {status === 'accepted'
                              ? '✓'
                              : ['queued', 'processing'].includes(status ?? '')
                                ? '◷'
                                : '○'}
                          </span>
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
                  {pending
                    ? '生成完成 · 等待审片'
                    : inProgress
                      ? `生成进度 ${inProgress.progress}%`
                      : currentCandidate
                        ? '已验收'
                        : '待生成'}
                </span>
              </div>
              {focus && (
                <>
                  <p>
                    镜头动作：{focus.shot.visible_action} · 运镜：{focus.shot.camera_movement} ·
                    转场：{focus.shot.transition}
                  </p>
                  <Field
                    label="视频提示词"
                    hint={
                      currentPromptDraft !== undefined
                        ? '未提交的本地草稿；切换镜头会保留，任务创建成功后随任务快照保存。'
                        : '以分镜动作与运镜作为默认提示，可在本次任务中调整，不改动锁定分镜。'
                    }
                  >
                    <textarea
                      rows={6}
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
                  {keyframe && (
                    <img
                      className="keyframe-preview"
                      src={api.keyframeFileUrl(projectId!, keyframe.id)}
                      alt="已验收关键帧"
                    />
                  )}
                  {currentCandidate?.file_url && (
                    <video
                      className="keyframe-preview"
                      controls
                      src={api.videoFileUrl(projectId!, currentCandidate.id)}
                    />
                  )}
                  {inProgress && (
                    <p>视频任务处理中，任务 ID 已保存。离开页面后可再次打开本页继续查看进度。</p>
                  )}
                  <div className="workspace-actions">
                    {!pending && (
                      <Button
                        variant="primary"
                        icon={
                          acceptedVideos.has(currentKey) ? (
                            <RefreshCw size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )
                        }
                        disabled={!profile || !consent || running || !keyframe}
                        onClick={() => generate.mutate({ draftKey: currentDraftKey, prompt })}
                      >
                        {acceptedVideos.has(currentKey) ? '重新生成此镜头' : '生成视频候选'}
                      </Button>
                    )}
                    {pending && pending.file_url && (
                      <>
                        <Field label="退回原因">
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="指出动作、镜头或一致性问题"
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
                          验收此视频
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
            <span className="eyebrow">POST GATE</span>
            <h2>成片合成门禁</h2>
          </div>
          <Clapperboard size={18} />
        </div>
        <p>
          逐镜视频已验收 {acceptedVideos.size} / {shots.length}。所有镜头通过后才能进入后期合成。
        </p>
        {stage?.status === 'accepted' && (
          <p className="success-copy">视频镜头覆盖完整，可以进入后期阶段。</p>
        )}
      </Panel>
    </div>
  );
}
