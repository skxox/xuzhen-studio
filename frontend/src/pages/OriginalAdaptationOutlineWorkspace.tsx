import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Plus, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { AdaptationOutlineRelease, AdaptationOutlineScene, Project } from '../lib/types';
import { AdaptationSceneEditor } from '../components/workspace/AdaptationSceneEditor';

type OutlineEpisode = AdaptationOutlineRelease['episodes'][number];
type OutlinePlan = {
  branch_id: string;
  release_id: string;
  episode_count: number;
  episode_seconds: number;
  aspect_ratio: string;
  creative_thesis: string;
  episodes: OutlineEpisode[];
};

function parseOutline(content?: string): OutlinePlan | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (
      typeof value === 'object' &&
      value !== null &&
      'branch_id' in value &&
      'release_id' in value &&
      'episodes' in value &&
      Array.isArray(value.episodes)
    )
      return value as OutlinePlan;
  } catch {
    return null;
  }
  return null;
}

function emptyScene(sceneNumber: number, sourceOrdinal: number): AdaptationOutlineScene {
  return {
    scene_number: sceneNumber,
    slugline: '内景 / 地点 / 日',
    location: '待设定地点',
    time_of_day: '日',
    character_names: ['待确认角色'],
    purpose: '明确本场的叙事作用。',
    conflict: '明确角色在本场面对的阻碍。',
    estimated_seconds: 30,
    source_chapter_ordinals: [sourceOrdinal],
    is_adaptation_addition: false,
    beats: [
      { beat_number: 1, action: '建立场景目标与人物行动。', turn: '人物关系或信息发生变化。' },
      { beat_number: 2, action: '推进冲突并作出选择。', turn: '形成下一场的行动压力。' },
    ],
  };
}

export function OriginalAdaptationOutlineWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; plan: OutlinePlan } | null>(null);
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
      query.state.data?.some((job) => job.stage_key === 'outline' && job.status === 'running')
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
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const outlineStage = stages.find((item) => item.stage_key === 'outline');
  const currentBranch = branchesQuery.data?.find((item) => item.is_current);
  const lockedChapters = useMemo(() => {
    const chapters = chaptersQuery.data ?? [];
    return currentBranch
      ? currentBranch.episodes
          .flatMap((episode) => episode.chapter_ordinals)
          .filter((ordinal, index, values) => values.indexOf(ordinal) === index)
          .sort((left, right) => left - right)
          .map((ordinal) => chapters.find((chapter) => chapter.ordinal === ordinal))
          .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter))
      : [];
  }, [chaptersQuery.data, currentBranch]);
  const outlineJob = jobsQuery.data?.find((job) => job.stage_key === 'outline');
  const candidate = parseOutline(outlineJob?.output?.content);
  const candidateKey = `${outlineJob?.id ?? ''}:${outlineJob?.output?.revision ?? 0}`;
  const plan = draft?.key === candidateKey ? draft.plan : candidate;
  const profileOptions = (profilesQuery.data ?? []).filter(
    (item) =>
      item.modality === 'text' && item.adapter_id === 'openai-compatible-chat' && item.enabled,
  );
  const profile = profileOptions.find((item) => item.id === profileId) ?? profileOptions[0];
  const literaryCharacterJob = jobsQuery.data?.find(
    (job) => job.stage_key === 'literaryCharacters' && job.status === 'succeeded',
  );
  const saved = Boolean(plan && candidate && JSON.stringify(plan) !== JSON.stringify(candidate));
  const currentOutline = outlinesQuery.data?.find((item) => item.is_current);
  const candidateLocked =
    outlineStage?.status === 'needs_review' || outlineStage?.status === 'running';
  const needsReview = outlineStage?.status === 'needs_review' && Boolean(candidate);
  const branchReady = Boolean(
    currentBranch && lockedChapters.length > 0 && lockedChapters.every(Boolean),
  );

  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['adaptation-outlines', projectId] }),
    ]);
  const generate = useMutation({
    mutationFn: async () => {
      if (!projectId || !currentBranch || !profile)
        throw new Error('需要当前已验收的改编分支和可用文本模型。');
      const prompt = [
        '你是影视改编总编剧。请基于已确认的逐集改编卡和锁版原文，输出严格符合 JSON 契约的视频改编大纲。不得输出 Markdown。',
        '逐集把叙事目标展开为场次与节拍，写明内外景/地点/时间、出场角色、场次目的、冲突、节拍行动与转折、预计秒数及原文章节出处。场次序号和节拍序号从 1 连续。引用的章节只能来自本集映射；纯新增场次必须将 is_adaptation_addition 设为 true，无法确认的人物和事实要标注待确认，不能冒充原著事实。每集全部场次的秒数合计不能超过单集目标时长；至少一场，每场至少两个节拍。',
        'JSON 顶层：branch_id, release_id, episode_count, episode_seconds, aspect_ratio, creative_thesis, episodes。每集：episode_number, source_chapter_ordinals, adaptation_summary, emotional_arc, ending_hook, scenes。每场：scene_number, slugline, location, time_of_day, character_names, purpose, conflict, estimated_seconds, source_chapter_ordinals, is_adaptation_addition, beats。每个节拍：beat_number, action, turn。只输出一个完整 JSON 对象。',
        `当前分支：${JSON.stringify({ branch_id: currentBranch.id, release_id: currentBranch.release_id, episode_count: currentBranch.episode_count, episode_seconds: currentBranch.episode_seconds, aspect_ratio: currentBranch.aspect_ratio })}`,
        '已接受的逐集映射（不能更改集序或章节来源）：',
        JSON.stringify(currentBranch.episodes),
        '锁版章节正文：',
        ...lockedChapters.map(
          (chapter) => `第${chapter.ordinal}章《${chapter.title}》\n${chapter.body}`,
        ),
        literaryCharacterJob?.output?.content
          ? `文学角色圣经（参考，人物身份和动机须服从锁版正文）：\n${literaryCharacterJob.output.content}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('分支正文超过单次文本任务长度限制；请缩小锁版范围后重新审校。');
      if (outlineStage?.status !== 'running') await api.startStage(projectId, 'outline');
      idempotencyKey.current = crypto.randomUUID();
      return api.createTextJob(projectId, {
        stage_key: 'outline',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt,
        parameters: { temperature: 0.4, max_tokens: 12000 },
        input_refs: [
          currentBranch.id,
          ...lockedChapters.map((chapter) => chapter.id),
          ...(literaryCharacterJob ? [literaryCharacterJob.id] : []),
        ],
        scope: {
          branch_id: currentBranch.id,
          branch_revision: currentBranch.revision,
          release_id: currentBranch.release_id,
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
        outlineJob!.id,
        JSON.stringify(plan),
        outlineJob!.output!.revision ?? 1,
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
        'outline',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReturnReason('');
      await refresh();
    },
  });
  const updateEpisode = (number: number, change: Partial<OutlineEpisode>) => {
    if (!plan) return;
    setDraft({
      key: candidateKey,
      plan: {
        ...plan,
        episodes: plan.episodes.map((episode) =>
          episode.episode_number === number ? { ...episode, ...change } : episode,
        ),
      },
    });
  };
  const status =
    outlineStage?.status === 'needs_review'
      ? '待人工审阅'
      : outlineStage?.status === 'accepted'
        ? '大纲已验收'
        : outlineStage?.status === 'running'
          ? '大纲生成中'
          : outlineStage?.status === 'stale'
            ? '上游已变化'
            : outlineStage?.status === 'failed'
              ? '上次生成失败'
              : '等待生成';

  if (!projectId || project?.creation_mode !== 'original')
    return (
      <Panel>
        此工作区仅用于原创小说改编分支。<Link to="/writing/adaptation">返回逐集改编交接</Link>
      </Panel>
    );

  return (
    <div className="writing-page adaptation-outline-page">
      <PageHeading
        eyebrow="ADAPTATION OUTLINE · EPISODIC SCENES"
        title="把逐集改编卡展开为可拍场次。"
        description="大纲候选绑定当前改编分支与锁版原文。每场追踪来源章节或标注为新增；每个节拍包含行动和转折，人工验收后形成分支内不可变大纲版本。"
        actions={
          <Badge
            tone={
              outlineStage?.status === 'accepted'
                ? 'green'
                : outlineStage?.status === 'needs_review'
                  ? 'gold'
                  : 'blue'
            }
            dot
          >
            {status}
          </Badge>
        }
      />
      <Panel className="outline-branch-context">
        <div>
          <b>当前改编分支</b>
          <span>
            {currentBranch
              ? `R${currentBranch.revision} · ${currentBranch.episode_count} 集 · ${currentBranch.episode_seconds} 秒 · ${currentBranch.aspect_ratio} · 锁版 ${currentBranch.release_id.slice(0, 8)}`
              : '尚无当前有效分支'}
          </span>
        </div>
        <div className="outline-context-links">
          <Link to="/writing/adaptation">
            查看逐集映射 <ArrowRight size={14} />
          </Link>
          <Link to="/canvas">
            查看流程 <ArrowRight size={14} />
          </Link>
        </div>
        {!branchReady && <p>先验收原创稿锁版和逐集章节映射；上游版本变化后此大纲候选会失效。</p>}
      </Panel>
      <div className="outline-production-layout">
        <div className="outline-production-main">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">MODEL & DATA GATE</div>
                <h2>生成设置</h2>
              </div>
              <Badge tone={branchReady ? 'green' : 'neutral'}>
                {branchReady ? '分支快照有效' : '等待上游门禁'}
              </Badge>
            </div>
            <div className="outline-model-row">
              <Field label="文本模型">
                <select
                  className="text-input select-input"
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
                </select>
              </Field>
              {!profileOptions.length && (
                <Link className="text-link" to="/settings">
                  尚无可用文本模型，前往设置 <ArrowRight size={14} />
                </Link>
              )}
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                我确认将锁版章节正文、角色参考和改编映射发送至所选模型服务处理。
              </label>
              <Button
                variant="primary"
                icon={<Sparkles size={15} />}
                disabled={
                  !branchReady || !profile || !consent || candidateLocked || generate.isPending
                }
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? '正在生成改编大纲…' : '生成分集场次大纲'}
              </Button>
              {(generate.error || branchesQuery.error || outlinesQuery.error) && (
                <span className="inline-error">
                  {String(generate.error ?? branchesQuery.error ?? outlinesQuery.error)}
                </span>
              )}
            </div>
          </Panel>
          {plan && (
            <Panel className="adaptation-outline-candidate">
              <div className="panel-heading-row">
                <div>
                  <div className="eyebrow">REVIEWABLE CANDIDATE</div>
                  <h2>场次与节拍审阅</h2>
                  <p>可编辑每集情绪弧、场次来源、时长和动作转折。单集场次时长不得超出分支设定。</p>
                </div>
                <Badge tone={saved ? 'gold' : 'green'}>
                  {saved ? '有未保存修改' : `候选修订 v${outlineJob?.output?.revision ?? 1}`}
                </Badge>
              </div>
              <fieldset className="outline-candidate-editor" disabled={!needsReview}>
                <Field label="全剧改编主张">
                  <TextArea
                    rows={3}
                    value={plan.creative_thesis}
                    onChange={(event) =>
                      setDraft({
                        key: candidateKey,
                        plan: { ...plan, creative_thesis: event.target.value },
                      })
                    }
                  />
                </Field>
                <div className="outline-episode-list">
                  {plan.episodes.map((episode) => (
                    <article className="outline-episode-card" key={episode.episode_number}>
                      <header>
                        <b>第 {episode.episode_number} 集</b>
                        <span>
                          来源章节：{episode.source_chapter_ordinals.join('、')} · 目标{' '}
                          {plan.episode_seconds} 秒
                        </span>
                        <span
                          className={
                            episode.scenes.reduce(
                              (total, scene) => total + scene.estimated_seconds,
                              0,
                            ) > plan.episode_seconds
                              ? 'is-over-budget'
                              : ''
                          }
                        >
                          场次预算{' '}
                          {episode.scenes.reduce(
                            (total, scene) => total + scene.estimated_seconds,
                            0,
                          )}{' '}
                          / {plan.episode_seconds} 秒
                        </span>
                      </header>
                      <div className="outline-episode-summary">
                        <Field label="本集改编概要">
                          <TextArea
                            rows={3}
                            value={episode.adaptation_summary}
                            onChange={(event) =>
                              updateEpisode(episode.episode_number, {
                                adaptation_summary: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="人物情绪弧">
                          <TextArea
                            rows={3}
                            value={episode.emotional_arc}
                            onChange={(event) =>
                              updateEpisode(episode.episode_number, {
                                emotional_arc: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="集尾钩子">
                          <TextArea
                            rows={2}
                            value={episode.ending_hook}
                            onChange={(event) =>
                              updateEpisode(episode.episode_number, {
                                ending_hook: event.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                      <div className="outline-scenes-heading">
                        <h3>场次（{episode.scenes.length}）</h3>
                        <Button
                          size="sm"
                          icon={<Plus size={14} />}
                          onClick={() =>
                            updateEpisode(episode.episode_number, {
                              scenes: [
                                ...episode.scenes,
                                emptyScene(
                                  episode.scenes.length + 1,
                                  episode.source_chapter_ordinals[0],
                                ),
                              ],
                            })
                          }
                        >
                          添加场次
                        </Button>
                      </div>
                      {episode.scenes.map((scene) => (
                        <AdaptationSceneEditor
                          key={scene.scene_number}
                          episodeNumber={episode.episode_number}
                          episodeChapterOrdinals={episode.source_chapter_ordinals}
                          episodeSeconds={plan.episode_seconds}
                          scene={scene}
                          canRemove={episode.scenes.length > 1}
                          onChange={(updated) =>
                            updateEpisode(episode.episode_number, {
                              scenes: episode.scenes.map((item) =>
                                item.scene_number === updated.scene_number ? updated : item,
                              ),
                            })
                          }
                          onRemove={() =>
                            updateEpisode(episode.episode_number, {
                              scenes: episode.scenes
                                .filter((item) => item.scene_number !== scene.scene_number)
                                .map((item, index) => ({ ...item, scene_number: index + 1 })),
                            })
                          }
                        />
                      ))}
                    </article>
                  ))}
                </div>
              </fieldset>
              {needsReview && (
                <div className="outline-review-actions">
                  <Field label="退回原因">
                    <TextInput
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                      placeholder="说明需要修改的结构或来源问题"
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
                    验收并锁定大纲版本
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
                <p className="inline-error">{String(save.error ?? decide.error)}</p>
              )}
            </Panel>
          )}
        </div>
        <aside className="outline-release-history">
          <Panel>
            <div className="panel-heading-row">
              <div>
                <div className="eyebrow">ACCEPTED OUTLINES</div>
                <h2>大纲版本</h2>
              </div>
              <Badge>{outlinesQuery.data?.length ?? 0}</Badge>
            </div>
            {currentOutline ? (
              <div className="outline-current-release">
                <Badge tone="green" dot>
                  当前大纲 v{currentOutline.revision}
                </Badge>
                <p>
                  {currentOutline.episode_count} 集 ·{' '}
                  {currentOutline.episodes.reduce((sum, episode) => sum + episode.scenes.length, 0)}{' '}
                  场
                </p>
                <p>{currentOutline.creative_thesis}</p>
              </div>
            ) : (
              <p className="muted-copy">大纲通过人工验收后，会形成当前改编分支的版本快照。</p>
            )}
            {(outlinesQuery.data ?? [])
              .filter((item) => !item.is_current)
              .map((outline) => (
                <details className="outline-history-item" key={outline.id}>
                  <summary>
                    分支大纲 v{outline.revision} · {outline.episode_count} 集
                  </summary>
                  <p>{outline.creative_thesis}</p>
                  <span>
                    {outline.episodes.reduce((sum, episode) => sum + episode.scenes.length, 0)} 场 ·
                    任务 {outline.job_id.slice(0, 8)}
                  </span>
                </details>
              ))}
          </Panel>
          <Panel className="outline-next-gate">
            <div className="eyebrow">NEXT GATE</div>
            <b>下一阶段：视频角色与美术</b>
            <p>
              场次大纲通过后，角色约束和美术设定仍需分别审核；分集剧本不能绕过这些门禁直接进入分镜。
            </p>
            <Link to="/canvas">
              流程观察台 <ArrowRight size={14} />
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
