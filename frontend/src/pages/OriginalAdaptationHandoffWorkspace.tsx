import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleAlert, GitBranch, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { AdaptationBranch, Project } from '../lib/types';

type EpisodeMap = AdaptationBranch['episodes'][number];
type MappingPlan = {
  release_id: string;
  episode_count: number;
  episode_seconds: number;
  aspect_ratio: string;
  episodes: EpisodeMap[];
};

const fields: Array<{
  key: keyof Omit<EpisodeMap, 'episode_number' | 'chapter_ordinals'>;
  label: string;
}> = [
  { key: 'target', label: '本集叙事目标' },
  { key: 'conflict', label: '核心冲突' },
  { key: 'turn', label: '关键转折' },
  { key: 'ending_hook', label: '集尾钩子' },
  { key: 'preserve_facts', label: '必须保留的原文事实' },
  { key: 'allowed_changes', label: '允许的改编调整' },
  { key: 'adaptation_note', label: '改编说明与待确认项' },
];

function parsePlan(content?: string): MappingPlan | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (
      typeof value === 'object' &&
      value !== null &&
      'episodes' in value &&
      'release_id' in value &&
      'episode_count' in value &&
      Array.isArray(value.episodes)
    )
      return value as MappingPlan;
  } catch {
    return null;
  }
  return null;
}

export function OriginalAdaptationHandoffWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [episodeCount, setEpisodeCount] = useState(project?.target_episodes ?? 8);
  const [episodeSeconds, setEpisodeSeconds] = useState(project?.episode_seconds ?? 120);
  const [aspectRatio, setAspectRatio] = useState(project?.aspect_ratio ?? '9:16');
  const [draft, setDraft] = useState<{ key: string; plan: MappingPlan } | null>(null);
  const [returnReason, setReturnReason] = useState('');
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
      query.state.data?.some((job) => job.stage_key === 'source' && job.status === 'running')
        ? 2500
        : false,
  });
  const chaptersQuery = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => api.chapters(projectId!),
    enabled: Boolean(projectId),
  });
  const releasesQuery = useQuery({
    queryKey: ['manuscript-releases', projectId],
    queryFn: () => api.manuscriptReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const branchesQuery = useQuery({
    queryKey: ['adaptation-branches', projectId],
    queryFn: () => api.adaptationBranches(projectId!),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const sourceStage = stages.find((item) => item.stage_key === 'source');
  const currentRelease = releasesQuery.data?.find((item) => item.is_current);
  const lockedChapters = useMemo(() => {
    const chapters = chaptersQuery.data ?? [];
    return (currentRelease?.chapter_versions ?? [])
      .map((ref) =>
        chapters.find(
          (chapter) =>
            chapter.id === ref.chapter_id &&
            chapter.version === ref.version &&
            chapter.content_hash === ref.content_hash,
        ),
      )
      .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter));
  }, [chaptersQuery.data, currentRelease]);
  const sourceJob = jobsQuery.data?.find((job) => job.stage_key === 'source');
  const candidate = parsePlan(sourceJob?.output?.content);
  const candidateKey = `${sourceJob?.id ?? ''}:${sourceJob?.output?.revision ?? 0}`;
  const plan = draft?.key === candidateKey ? draft.plan : candidate;
  const profileOptions = (profilesQuery.data ?? []).filter(
    (item) =>
      item.modality === 'text' && item.adapter_id === 'openai-compatible-chat' && item.enabled,
  );
  const profile = profileOptions.find((item) => item.id === profileId) ?? profileOptions[0];
  const latestCharacterJob = jobsQuery.data?.find(
    (job) => job.stage_key === 'literaryCharacters' && job.status === 'succeeded',
  );
  const saved = Boolean(plan && candidate && JSON.stringify(plan) !== JSON.stringify(candidate));
  const mappingReady = Boolean(
    currentRelease &&
    lockedChapters.length === currentRelease.chapter_versions.length &&
    lockedChapters.length >= 2,
  );
  const acceptedBranch = branchesQuery.data?.find((item) => item.is_current);
  const candidateLocked =
    sourceStage?.status === 'needs_review' || sourceStage?.status === 'running';

  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['adaptation-branches', projectId] }),
    ]);
  const generate = useMutation({
    mutationFn: async () => {
      if (!projectId || !currentRelease || !profile)
        throw new Error('需要当前有效锁版和可用的文本模型。');
      if (episodeCount < 1 || episodeCount > lockedChapters.length)
        throw new Error('集数必须在 1 到锁版章节数之间。');
      const scope = {
        release_id: currentRelease.id,
        episode_count: episodeCount,
        episode_seconds: episodeSeconds,
        aspect_ratio: aspectRatio,
      };
      const prompt = [
        '你是影视改编策划。根据已锁定的原创稿，为每集提出章节映射和可审阅的改编规划。只输出符合给定 JSON 结构的 JSON，不要 Markdown。',
        '每个锁版章节必须且只能分配一次；章节序号在全剧内必须连续、按原文顺序、每集内也连续。每集至少一章。按因果链分配集目标、冲突、转折和集尾钩子。尊重“必须保留事实”，把压缩、合并、顺序调整等建议写入允许调整及改编说明；不得将推断写成原文事实。',
        '字段格式：{"release_id":string,"episode_count":number,"episode_seconds":number,"aspect_ratio":string,"episodes":[{"episode_number":number,"chapter_ordinals":[number],"target":string,"conflict":string,"turn":string,"ending_hook":string,"preserve_facts":string,"allowed_changes":string,"adaptation_note":string}]}',
        `参数：${JSON.stringify(scope)}`,
        '锁版章节（序号、标题、正文）：',
        ...lockedChapters.map(
          (chapter) => `第${chapter.ordinal}章《${chapter.title}》\n${chapter.body}`,
        ),
        latestCharacterJob?.output?.content
          ? `文学角色圣经（辅助参考，不得覆盖原文）：\n${latestCharacterJob.output.content}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('锁版正文超出单次文本任务长度限制，请减少章节范围后重新锁版。');
      if (sourceStage?.status !== 'running') await api.startStage(projectId, 'source');
      idempotencyKey.current = crypto.randomUUID();
      return api.createTextJob(projectId, {
        stage_key: 'source',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt,
        parameters: { temperature: 0.35, max_tokens: 8000 },
        input_refs: [
          ...lockedChapters.map((chapter) => chapter.id),
          ...(latestCharacterJob ? [latestCharacterJob.id] : []),
        ],
        scope,
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
        sourceJob!.id,
        JSON.stringify(plan),
        sourceJob!.output!.revision ?? 1,
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
        'source',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReturnReason('');
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['manuscript-releases', projectId] });
    },
  });
  const editEpisode = (episodeNumber: number, change: Partial<EpisodeMap>) => {
    if (!plan) return;
    setDraft({
      key: candidateKey,
      plan: {
        ...plan,
        episodes: plan.episodes.map((episode) =>
          episode.episode_number === episodeNumber ? { ...episode, ...change } : episode,
        ),
      },
    });
  };
  const status =
    sourceStage?.status === 'needs_review'
      ? '待人工审阅'
      : sourceStage?.status === 'accepted'
        ? '分支已锁定'
        : sourceStage?.status === 'running'
          ? '映射生成中'
          : sourceStage?.status === 'stale'
            ? '上游已变化'
            : sourceStage?.status === 'failed'
              ? '上次生成失败'
              : '等待生成';

  if (!projectId || project?.creation_mode !== 'original')
    return (
      <Panel>
        此工作区仅用于原创小说锁版后的改编交接。<Link to="/writing/continuity">返回连续性审校</Link>
      </Panel>
    );

  return (
    <div className="writing-page original-handoff-page">
      <PageHeading
        eyebrow="ORIGINAL NOVEL · ADAPTATION HANDOFF"
        title="从锁版原稿生成逐集改编分支。"
        description="AI 先提出分集与章节映射，作者逐集审阅后才固化为版本化分支。原稿发布版本保持不可变；章节覆盖、顺序和引用版本由服务端校验。"
        actions={
          <Badge
            tone={
              sourceStage?.status === 'accepted'
                ? 'green'
                : sourceStage?.status === 'needs_review'
                  ? 'gold'
                  : 'blue'
            }
            dot
          >
            {status}
          </Badge>
        }
      />
      <Panel className="handoff-prerequisite">
        <div>
          <b>上游锁版</b>
          <span>
            {currentRelease
              ? `稿件 R${currentRelease.revision} · 第 ${currentRelease.chapter_start}–${currentRelease.chapter_end} 章 · ${lockedChapters.length} 章`
              : '没有当前有效的原创稿锁版'}
          </span>
        </div>
        <Link to="/writing/continuity">
          查看连续性审校与锁版 <ArrowRight size={14} />
        </Link>
        {!mappingReady && (
          <p role="alert">
            <CircleAlert size={15} />{' '}
            请先完成连续性审校、锁版和权利状态确认；如果章节版本发生变化，需要重新审校并锁版。
          </p>
        )}
      </Panel>

      <div className="handoff-layout">
        <div className="handoff-main">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">AI PLANNING</div>
                <h2>分集规划条件</h2>
              </div>
              <Badge tone={mappingReady ? 'green' : 'neutral'}>
                {mappingReady ? '锁版有效' : '需先锁版'}
              </Badge>
            </div>
            <div className="handoff-fields">
              <Field label="目标集数" hint={`最多 ${lockedChapters.length} 集；每集至少分配一章`}>
                <TextInput
                  type="number"
                  min={1}
                  max={Math.max(1, lockedChapters.length)}
                  value={episodeCount}
                  disabled={candidateLocked}
                  onChange={(event) => {
                    setConsent(false);
                    setEpisodeCount(Number(event.target.value));
                  }}
                />
              </Field>
              <Field label="单集目标时长（秒）">
                <TextInput
                  type="number"
                  min={10}
                  max={7200}
                  value={episodeSeconds}
                  disabled={candidateLocked}
                  onChange={(event) => {
                    setConsent(false);
                    setEpisodeSeconds(Number(event.target.value));
                  }}
                />
              </Field>
              <Field label="画幅">
                <SelectInput
                  value={aspectRatio}
                  disabled={candidateLocked}
                  onChange={(event) => {
                    setConsent(false);
                    setAspectRatio(event.target.value);
                  }}
                >
                  <option value="9:16">9:16 竖屏</option>
                  <option value="16:9">16:9 横屏</option>
                  <option value="1:1">1:1 方形</option>
                </SelectInput>
              </Field>
              <Field label="文本模型">
                <SelectInput
                  value={profile?.id ?? ''}
                  disabled={candidateLocked}
                  onChange={(event) => {
                    setConsent(false);
                    setProfileId(event.target.value);
                  }}
                >
                  <option value="">选择已启用的文本 API</option>
                  {profileOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.model_id}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{' '}
              我确认将锁版章节正文及角色参考发送至所选模型服务处理。
            </label>
            <div className="handoff-actions">
              <Button
                variant="primary"
                icon={<Sparkles size={15} />}
                disabled={
                  !mappingReady ||
                  !profile ||
                  !consent ||
                  generate.isPending ||
                  sourceStage?.status === 'needs_review'
                }
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? '正在生成分集映射…' : '生成分集映射候选'}
              </Button>
              {generate.error && <span className="inline-error">{generate.error.message}</span>}
            </div>
          </Panel>

          {plan && (
            <Panel className="handoff-candidate">
              <div className="panel-heading-row">
                <div>
                  <div className="eyebrow">REVIEWABLE CANDIDATE</div>
                  <h2>逐集章节映射与改编卡</h2>
                  <p>编辑章节序号及各集策划字段，保存后由后端重新校验覆盖、顺序和锁版引用。</p>
                </div>
                <Badge tone={saved ? 'gold' : 'green'}>
                  {saved ? '有未保存修改' : `候选 R${sourceJob?.output?.revision ?? 1}`}
                </Badge>
              </div>
              <div className="episode-map-list">
                {plan.episodes.map((episode) => (
                  <article className="episode-map-card" key={episode.episode_number}>
                    <header>
                      <b>第 {episode.episode_number} 集</b>
                      <span>
                        {plan.episode_seconds} 秒 · {plan.aspect_ratio}
                      </span>
                    </header>
                    <Field label="原文章节序号" hint="逗号分隔；接受时必须完整覆盖且保持连续原序">
                      <TextInput
                        value={episode.chapter_ordinals.join(', ')}
                        onChange={(event) =>
                          editEpisode(episode.episode_number, {
                            chapter_ordinals: event.target.value
                              .split(',')
                              .map((value) => Number(value.trim()))
                              .filter(Number.isInteger),
                          })
                        }
                      />
                    </Field>
                    <div className="episode-map-fields">
                      {fields.map(({ key, label }) => (
                        <Field key={key} label={label}>
                          <TextArea
                            rows={key === 'preserve_facts' || key === 'allowed_changes' ? 3 : 2}
                            value={episode[key]}
                            onChange={(event) =>
                              editEpisode(episode.episode_number, { [key]: event.target.value })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {sourceStage?.status === 'needs_review' && (
                <div className="handoff-review-actions">
                  <Field label="退回修改原因">
                    <TextInput
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                      placeholder="说明需要重新生成或修改的内容"
                    />
                  </Field>
                  <Button
                    disabled={saved || save.isPending || !plan.episodes.length}
                    onClick={() => save.mutate()}
                  >
                    保存候选修改
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Check size={15} />}
                    disabled={saved || decide.isPending}
                    onClick={() => decide.mutate('accept')}
                  >
                    审阅通过并创建改编分支
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!returnReason.trim() || decide.isPending}
                    onClick={() => decide.mutate('reject')}
                  >
                    退回重新规划
                  </Button>
                </div>
              )}
              {(save.error || decide.error) && (
                <p className="inline-error" role="alert">
                  {save.error?.message ?? decide.error?.message}
                </p>
              )}
            </Panel>
          )}
        </div>

        <aside className="handoff-history">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">BRANCH HISTORY</div>
                <h2>改编分支</h2>
              </div>
              <GitBranch size={18} />
            </div>
            {acceptedBranch ? (
              <div className="branch-current">
                <Badge tone="green" dot>
                  当前分支 R{acceptedBranch.revision}
                </Badge>
                <p>
                  {acceptedBranch.episode_count} 集 · {acceptedBranch.episode_seconds} 秒 ·{' '}
                  {acceptedBranch.aspect_ratio}
                </p>
                <p>关联稿件发布版本：{acceptedBranch.release_id.slice(0, 8)}…</p>
                <p>
                  已固化 {acceptedBranch.episodes.length} 集映射，重生成会创建新分支版本并保留历史。
                </p>
              </div>
            ) : (
              <p className="muted-copy">通过人工审阅后，分集映射会形成可追溯的改编分支。</p>
            )}
            {(branchesQuery.data ?? [])
              .filter((item) => !item.is_current)
              .map((branch) => (
                <details className="branch-history-item" key={branch.id}>
                  <summary>
                    分支 R{branch.revision} · {branch.episode_count} 集{' '}
                    <span>稿件 R{branch.release_id.slice(0, 8)}</span>
                  </summary>
                  <ol>
                    {branch.episodes.map((episode) => (
                      <li key={episode.episode_number}>
                        E{String(episode.episode_number).padStart(2, '0')} · 第{' '}
                        {episode.chapter_ordinals.join('、')} 章 · {episode.target}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
          </Panel>
          <Panel className="handoff-next">
            <div className="eyebrow">NEXT GATE</div>
            <b>改编分支将进入剧本制作</b>
            <p>本阶段只确定逐集来源、叙事目标和改编边界。剧本生成及其审阅仍由后续阶段独立控制。</p>
            <Link to="/canvas">
              在流程观察台查看阶段状态 <ArrowRight size={14} />
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
