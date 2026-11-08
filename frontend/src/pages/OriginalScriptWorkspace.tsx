import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScriptSceneEditor } from '../components/workspace/ScriptSceneEditor';
import { AdaptationTextGate } from '../components/workspace/AdaptationTextGate';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project, ScriptRelease, ScriptScene } from '../lib/types';

type ScriptPlan = {
  branch_id: string;
  release_id: string;
  outline_release_id: string;
  character_job_id: string;
  art_job_id: string;
  episode_count: number;
  episodes: ScriptRelease['episodes'];
};

function parseScript(content?: string): ScriptPlan | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (
      typeof value === 'object' &&
      value !== null &&
      'branch_id' in value &&
      'outline_release_id' in value &&
      'episodes' in value &&
      Array.isArray(value.episodes)
    )
      return value as ScriptPlan;
  } catch {
    return null;
  }
  return null;
}

export function OriginalScriptWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; plan: ScriptPlan } | null>(null);
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
      query.state.data?.some((job) => job.stage_key === 'script' && job.status === 'running')
        ? 2500
        : false,
  });
  const chaptersQuery = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => api.chapters(projectId!),
    enabled: Boolean(projectId),
  });
  const branchesQuery = useQuery({
    queryKey: ['adaptation-branches', projectId],
    queryFn: () => api.adaptationBranches(projectId!),
    enabled: Boolean(projectId),
  });
  const outlinesQuery = useQuery({
    queryKey: ['adaptation-outlines', projectId],
    queryFn: () => api.adaptationOutlines(projectId!),
    enabled: Boolean(projectId),
  });
  const releasesQuery = useQuery({
    queryKey: ['script-releases', projectId],
    queryFn: () => api.scriptReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const scriptStage = stages.find((stage) => stage.stage_key === 'script');
  const outlineStage = stages.find((stage) => stage.stage_key === 'outline');
  const characterStage = stages.find((stage) => stage.stage_key === 'characters');
  const artStage = stages.find((stage) => stage.stage_key === 'art');
  const branch = branchesQuery.data?.find((item) => item.is_current);
  const outline = outlinesQuery.data?.find(
    (item) => item.is_current && item.branch_id === branch?.id,
  );
  const jobs = jobsQuery.data ?? [];
  const characterJobId =
    typeof characterStage?.decision.candidate_job_id === 'string'
      ? characterStage.decision.candidate_job_id
      : '';
  const artJobId =
    typeof artStage?.decision.candidate_job_id === 'string'
      ? artStage.decision.candidate_job_id
      : '';
  const characterJobQuery = useQuery({
    queryKey: ['job', projectId, characterJobId],
    queryFn: () => api.job(projectId!, characterJobId),
    enabled: Boolean(projectId && characterJobId),
  });
  const artJobQuery = useQuery({
    queryKey: ['job', projectId, artJobId],
    queryFn: () => api.job(projectId!, artJobId),
    enabled: Boolean(projectId && artJobId),
  });
  const characterJob = characterJobQuery.data;
  const artJob = artJobQuery.data;
  const lockedChapters = useMemo(() => {
    const allChapters = chaptersQuery.data ?? [];
    const ordinals = branch?.episodes.flatMap((episode) => episode.chapter_ordinals) ?? [];
    return [...new Set(ordinals)]
      .sort((left, right) => left - right)
      .map((ordinal) => allChapters.find((chapter) => chapter.ordinal === ordinal))
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter));
  }, [branch, chaptersQuery.data]);
  const textProfiles = (profilesQuery.data ?? []).filter(
    (profile) =>
      profile.modality === 'text' &&
      profile.adapter_id === 'openai-compatible-chat' &&
      profile.enabled,
  );
  const profile = textProfiles.find((item) => item.id === profileId) ?? textProfiles[0];
  const scriptJob = jobs.find((job) => job.stage_key === 'script');
  const candidate = parseScript(scriptJob?.output?.content);
  const candidateKey = `${scriptJob?.id ?? ''}:${scriptJob?.output?.revision ?? 0}`;
  const plan = draft?.key === candidateKey ? draft.plan : candidate;
  const saved = Boolean(plan && candidate && JSON.stringify(plan) !== JSON.stringify(candidate));
  const needsReview = scriptStage?.status === 'needs_review' && Boolean(candidate);
  const running = scriptStage?.status === 'running' || scriptJob?.status === 'running';
  const gatesReady = Boolean(
    branch &&
    outline &&
    outlineStage?.status === 'accepted' &&
    characterStage?.status === 'accepted' &&
    characterJob?.output?.content &&
    artStage?.status === 'accepted' &&
    artJob?.output?.content &&
    lockedChapters.length > 0,
  );
  const currentScript = releasesQuery.data?.find((release) => release.is_current);

  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['script-releases', projectId] }),
    ]);
  const generate = useMutation({
    mutationFn: async () => {
      if (!projectId || !branch || !outline || !characterJob || !artJob || !profile)
        throw new Error('必须验收当前大纲、角色和美术阶段，并配置可用文本模型。');
      const prompt = [
        '你是影视分集编剧。严格基于当前已验收的视频改编大纲编写可拍摄剧本，只输出 JSON，不得输出 Markdown。',
        '逐集、逐场完整覆盖已验收大纲中的所有场次，场次序号不得重排。锁定场景名、地点、时段及章节来源，不新增未审核场次。逐场写可视化动作，拆分对白/旁白，每句标注说话人、情绪、表达方式、预计秒数、出处章节和 origin（direct_quote/adaptation/original）。direct_quote 必须逐字复制原文，禁止修饰标点或删节；无法确认来源时禁止伪标成直引。改编对白要引用对应章节；新增场次中对白可无章节来源。人物称谓、行为边界和视觉/美术规则须服从已验收角色与美术产物。动作时间加对白时间不能超过大纲该场时长，集数和场次必须全部覆盖。',
        '格式：顶层 branch_id, release_id, outline_release_id, character_job_id, art_job_id, episode_count, episodes。每集 {episode_number, scenes:[{scene_number, action, action_seconds, dialogues:[{dialogue_number, speaker, text, emotion, delivery, estimated_seconds, source_chapter_ordinals, origin}]}]}。',
        `当前引用：${JSON.stringify({ branch_id: branch.id, release_id: branch.release_id, outline_release_id: outline.id, character_job_id: characterJob.id, art_job_id: artJob.id, episode_count: outline.episode_count })}`,
        '已验收场次大纲：',
        JSON.stringify(outline),
        '已验收角色约束：',
        characterJob.output!.content,
        '已验收美术设定：',
        artJob.output!.content,
        '当前锁版章节原文（直引核验依据）：',
        ...lockedChapters.map(
          (chapter) => `第${chapter.ordinal}章《${chapter.title}》\n${chapter.body}`,
        ),
      ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error(
          '剧本生成上下文超过单次任务长度限制；请缩小锁版范围或精简角色、美术设定后再试。',
        );
      if (scriptStage?.status !== 'running') await api.startStage(projectId, 'script');
      idempotencyKey.current = crypto.randomUUID();
      return api.createTextJob(projectId, {
        stage_key: 'script',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt,
        parameters: { temperature: 0.45, max_tokens: 16000 },
        input_refs: [
          branch.id,
          outline.id,
          characterJob.id,
          artJob.id,
          ...lockedChapters.map((chapter) => chapter.id),
        ],
        scope: {
          branch_id: branch.id,
          outline_release_id: outline.id,
          character_job_id: characterJob.id,
          art_job_id: artJob.id,
          episode_count: outline.episode_count,
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
        scriptJob!.id,
        JSON.stringify(plan),
        scriptJob!.output!.revision ?? 1,
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
        'script',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReturnReason('');
      await refresh();
    },
  });
  const updateEpisode = (number: number, scenes: ScriptScene[]) => {
    if (!plan) return;
    setDraft({
      key: candidateKey,
      plan: {
        ...plan,
        episodes: plan.episodes.map((episode) =>
          episode.episode_number === number ? { ...episode, scenes } : episode,
        ),
      },
    });
  };
  const status =
    scriptStage?.status === 'needs_review'
      ? '待人工审阅'
      : scriptStage?.status === 'accepted'
        ? '剧本已验收'
        : scriptStage?.status === 'running'
          ? '剧本生成中'
          : scriptStage?.status === 'stale'
            ? '上游已变化'
            : scriptStage?.status === 'failed'
              ? '上次生成失败'
              : '等待角色与美术门禁';

  if (!projectId || project?.creation_mode !== 'original')
    return (
      <Panel>
        此工作区仅用于原创小说改编分支。
        <Link to="/writing/adaptation-outline">返回视频改编大纲</Link>
      </Panel>
    );

  return (
    <div className="writing-page script-production-page">
      <PageHeading
        eyebrow="EPISODIC SCRIPT · TRACEABLE DRAFT"
        title="把已验收场次展开为分集剧本。"
        description="剧本绑定当前改编分支、大纲、角色与美术版本。逐场编辑动作、对白时长和来源；原文直引由服务端逐字核验，验收后生成只读剧本版本。"
        actions={
          <Badge
            tone={scriptStage?.status === 'accepted' ? 'green' : needsReview ? 'gold' : 'blue'}
            dot
          >
            {status}
          </Badge>
        }
      />
      <Panel className="script-gate-panel">
        <div className="panel-heading-row">
          <div>
            <div className="eyebrow">UPSTREAM VERSION GATES</div>
            <h2>剧本冻结输入</h2>
          </div>
          <Link to="/canvas">
            流程观察台 <ArrowRight size={14} />
          </Link>
        </div>
        <div className="script-gate-list">
          {[
            {
              label: '当前改编分支',
              status: branch ? `R${branch.revision} · ${branch.episode_count} 集` : '未验收',
              href: '/writing/adaptation',
            },
            {
              label: '视频改编大纲',
              status:
                outlineStage?.status === 'accepted' && outline
                  ? `v${outline.revision} · ${outline.episode_count} 集`
                  : (outlineStage?.status ?? '未完成'),
              href: '/writing/adaptation-outline',
            },
            {
              label: '视频角色约束',
              status:
                characterStage?.status === 'accepted' && characterJob?.output
                  ? '已验收且可追溯'
                  : (characterStage?.status ?? '需重新生成并验收'),
              href: '/assets',
            },
            {
              label: '美术设定',
              status:
                artStage?.status === 'accepted' && artJob?.output
                  ? '已验收且可追溯'
                  : (artStage?.status ?? '需重新生成并验收'),
              href: '/assets',
            },
          ].map((gate) => (
            <div className="script-gate-item" key={gate.label}>
              <span>{gate.label}</span>
              <Badge
                tone={
                  gate.status.includes('已验收') ||
                  gate.status.startsWith('R') ||
                  gate.status.startsWith('v')
                    ? 'green'
                    : 'gold'
                }
              >
                {gate.status}
              </Badge>
              <Link to={gate.href}>
                查看 <ArrowRight size={12} />
              </Link>
            </div>
          ))}
        </div>
        {branch &&
          outlineStage?.status === 'accepted' &&
          characterStage?.status === 'accepted' &&
          artStage?.status === 'accepted' &&
          (!characterJob || !artJob) && (
            <p className="inline-notice">
              角色/美术阶段之前的验收没有保存候选任务
              ID。请分别重新生成并验收，之后才能将确切版本纳入剧本快照。
            </p>
          )}
      </Panel>
      <AdaptationTextGate stageKey="characters" project={project} />
      <AdaptationTextGate stageKey="art" project={project} />
      <div className="script-production-layout">
        <div className="script-production-main">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">MODEL & DATA CONSENT</div>
                <h2>生成剧本候选</h2>
              </div>
              <Badge tone={gatesReady ? 'green' : 'neutral'}>
                {gatesReady ? '上游版本已锁定' : '等待上游阶段'}
              </Badge>
            </div>
            <div className="script-generation-controls">
              <Field label="文本模型">
                <select
                  className="text-input select-input"
                  value={profile?.id ?? ''}
                  disabled={running || needsReview}
                  onChange={(event) => {
                    setConsent(false);
                    setProfileId(event.target.value);
                  }}
                >
                  <option value="">选择已启用的文本 API</option>
                  {textProfiles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.model_id}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={running}
                />
                我确认将锁版正文、剧本大纲、角色和美术资料发送至所选模型服务。
              </label>
              <Button
                variant="primary"
                icon={<Sparkles size={15} />}
                disabled={!gatesReady || !profile || !consent || running || needsReview}
                onClick={() => generate.mutate()}
              >
                {generate.isPending || running ? '正在生成分集剧本…' : '生成剧本候选'}
              </Button>
              {!textProfiles.length && (
                <Link to="/settings" className="text-link">
                  配置文本 API <ArrowRight size={13} />
                </Link>
              )}
              {(generate.error || releasesQuery.error) && (
                <p className="inline-error">{String(generate.error ?? releasesQuery.error)}</p>
              )}
            </div>
          </Panel>
          {plan && (
            <Panel className="script-candidate-panel">
              <div className="panel-heading-row">
                <div>
                  <div className="eyebrow">SCRIPT CANDIDATE</div>
                  <h2>逐集动作与对白</h2>
                  <p>场次结构来自已验收大纲，不在剧本阶段增删场次；对白直引通过原文精确匹配。</p>
                </div>
                <Badge tone={saved ? 'gold' : 'green'}>
                  {saved ? '有未保存修改' : `候选修订 v${scriptJob?.output?.revision ?? 1}`}
                </Badge>
              </div>
              <fieldset className="script-candidate-editor" disabled={!needsReview}>
                {plan.episodes.map((episode) => {
                  const outlineEpisode = outline?.episodes.find(
                    (item) => item.episode_number === episode.episode_number,
                  );
                  return (
                    <article className="script-episode-card" key={episode.episode_number}>
                      <header>
                        <b>第 {episode.episode_number} 集</b>
                        <span>{episode.scenes.length} 场 · 预计时长不超过分支目标</span>
                      </header>
                      {episode.scenes.map((scene) => {
                        const outlineScene = outlineEpisode?.scenes.find(
                          (item) => item.scene_number === scene.scene_number,
                        );
                        if (!outlineScene) return null;
                        return (
                          <ScriptSceneEditor
                            key={scene.scene_number}
                            scene={scene}
                            outlineScene={outlineScene}
                            onChange={(updated) =>
                              updateEpisode(
                                episode.episode_number,
                                episode.scenes.map((item) =>
                                  item.scene_number === updated.scene_number ? updated : item,
                                ),
                              )
                            }
                          />
                        );
                      })}
                    </article>
                  );
                })}
              </fieldset>
              {needsReview && (
                <div className="script-review-actions">
                  <Field label="退回原因">
                    <TextInput
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                      placeholder="例如：对白来源不清、人物动机偏离或时长超出"
                    />
                  </Field>
                  <Button disabled={!saved || save.isPending} onClick={() => save.mutate()}>
                    保存候选修订
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Check size={15} />}
                    disabled={saved || decide.isPending}
                    onClick={() => decide.mutate('accept')}
                  >
                    验收并发布剧本版本
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!returnReason.trim() || decide.isPending}
                    onClick={() => decide.mutate('reject')}
                  >
                    退回重新编写
                  </Button>
                </div>
              )}
              {(save.error || decide.error) && (
                <p className="inline-error">{String(save.error ?? decide.error)}</p>
              )}
            </Panel>
          )}
        </div>
        <aside className="script-release-history">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">SCRIPT RELEASES</div>
                <h2>剧本版本</h2>
              </div>
              <Badge>{releasesQuery.data?.length ?? 0}</Badge>
            </div>
            {currentScript ? (
              <div className="script-current-release">
                <Badge tone="green" dot>
                  当前剧本 v{currentScript.revision}
                </Badge>
                <p>
                  {currentScript.episode_count} 集 ·{' '}
                  {currentScript.episodes.reduce(
                    (sum, episode) =>
                      sum +
                      episode.scenes.reduce((count, scene) => count + scene.dialogues.length, 0),
                    0,
                  )}{' '}
                  条对白
                </p>
                <p>
                  大纲 {currentScript.outline_release_id.slice(0, 8)} · 角色任务{' '}
                  {currentScript.character_job_id.slice(0, 8)} · 美术任务{' '}
                  {currentScript.art_job_id.slice(0, 8)}
                </p>
              </div>
            ) : (
              <p className="muted-copy">验收剧本后在此保留版本快照和上游引用。</p>
            )}
            {(releasesQuery.data ?? [])
              .filter((item) => !item.is_current)
              .map((release) => (
                <details className="script-history-item" key={release.id}>
                  <summary>
                    剧本 v{release.revision} · {release.episode_count} 集
                  </summary>
                  <span>
                    {release.created_at ? new Date(release.created_at).toLocaleString() : ''} · 任务{' '}
                    {release.job_id.slice(0, 8)}
                  </span>
                </details>
              ))}
          </Panel>
          <Panel className="script-next-gate">
            <div className="eyebrow">NEXT GATE</div>
            <b>下一阶段：逐镜分镜</b>
            <p>当前只完成剧本版本。分镜仍须从已验收剧本逐场拆镜，并继续保留剧本与原文来源。</p>
            <Link to="/canvas">
              流程观察台 <ArrowRight size={14} />
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
