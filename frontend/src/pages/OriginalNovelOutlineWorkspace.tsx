import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, Sparkles } from 'lucide-react';
import type { Project } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';

export function OriginalNovelOutlineWorkspace({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [candidateReason, setCandidateReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; content: string } | null>(null);
  const idempotencyKey = useRef('');
  const stagesQuery = useQuery({
    queryKey: ['stages', project.id],
    queryFn: () => api.stages(project.id),
    retry: false,
  });
  const briefQuery = useQuery({
    queryKey: ['creative-brief', project.id],
    queryFn: () => api.creativeBrief(project.id),
    retry: false,
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', project.id],
    queryFn: () => api.serviceProfiles(project.id),
    retry: false,
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', project.id],
    queryFn: () => api.jobs(project.id),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.stage_key === 'novelOutline' && job.status === 'running')
        ? 3000
        : false,
  });
  const stages = stagesQuery.data ?? [];
  const storyBibleStage = stages.find((stage) => stage.stage_key === 'storyBible');
  const outlineStage = stages.find((stage) => stage.stage_key === 'novelOutline');
  const storyBibleJob = jobsQuery.data?.find((job) => job.stage_key === 'storyBible');
  const outlineJob = jobsQuery.data?.find((job) => job.stage_key === 'novelOutline');
  const textProfiles =
    profilesQuery.data?.filter(
      (profile) => profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat',
    ) ?? [];
  const profile =
    textProfiles.find((item) => item.id === selectedProfileId && item.enabled) ??
    textProfiles.find((item) => item.enabled);
  const candidateKey = `${outlineJob?.id ?? ''}:${outlineJob?.output?.revision ?? 0}`;
  const candidateContent =
    draft?.key === candidateKey ? draft.content : (outlineJob?.output?.content ?? '');
  const versionsQuery = useQuery({
    queryKey: ['job-output-versions', project.id, outlineJob?.id],
    queryFn: () => api.jobOutputVersions(project.id, outlineJob!.id),
    enabled: Boolean(outlineJob?.output),
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!profile || !storyBibleJob?.output?.content)
        throw new Error('需要已验收的故事圣经和已测试连通的文本服务。');
      const prompt = [
        '你是长篇小说策划编辑。请基于已验收的故事圣经，为原创小说编制可执行的长篇大纲候选。不得改写已确认世界规则；推断内容需标出待作者确认。',
        '按规划规模安排分卷与章节，并使用 Markdown 输出：整体主线与卷间递进；每卷的核心冲突、转折和卷末钩子；每章分别列出标题、叙事目标、主视角、角色目标、阻碍、关键转折、章末钩子、承接的设定依据、待确认事项。避免重复章节功能，保证因果递进和人物弧连续。',
        `计划规模：${briefQuery.data?.planned_scope ?? '由故事圣经及作者规划确定'}`,
        `题材：${briefQuery.data?.genre ?? project.genre ?? '未指定'}`,
        '已验收故事圣经：',
        storyBibleJob.output.content,
      ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('故事圣经内容过长，超过单次文本任务上限；请先精简或拆分后再生成。');
      if (outlineStage?.status !== 'running') await api.startStage(project.id, 'novelOutline');
      return api.createTextJob(project.id, {
        stage_key: 'novelOutline',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current || (idempotencyKey.current = crypto.randomUUID()),
        prompt,
        parameters: { temperature: 0.65, max_tokens: 8000 },
        input_refs: [storyBibleJob.id],
        data_authorized: consent,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      ]);
      setConsent(false);
      if (result.status !== 'running') idempotencyKey.current = '';
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      ]);
    },
  });
  const saveCandidate = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        project.id,
        outlineJob!.id,
        candidateContent,
        outlineJob!.output!.revision ?? 1,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
        queryClient.invalidateQueries({
          queryKey: ['job-output-versions', project.id, outlineJob?.id],
        }),
      ]);
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project.id,
        'novelOutline',
        action,
        action === 'reject' ? candidateReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setCandidateReason('');
      await queryClient.invalidateQueries({ queryKey: ['stages', project.id] });
    },
  });

  const waiting = outlineStage?.status === 'needs_review' && Boolean(outlineJob?.output?.content);
  const canGenerate =
    storyBibleStage?.status === 'accepted' && outlineStage?.status !== 'needs_review';
  const generateDisabled =
    !profile ||
    !consent ||
    !storyBibleJob?.output?.content ||
    generate.isPending ||
    outlineJob?.status === 'running' ||
    !canGenerate;
  const status =
    outlineStage?.status === 'needs_review'
      ? '待审阅'
      : outlineStage?.status === 'accepted'
        ? '已验收'
        : outlineStage?.status === 'running'
          ? '生成中'
          : outlineStage?.status === 'failed'
            ? '生成失败'
            : outlineStage?.status === 'stale'
              ? '已过期'
              : outlineStage?.status === 'ready'
                ? '可开始'
                : '等待故事圣经';

  return (
    <div className="writing-page original-outline-page">
      <PageHeading
        eyebrow="ORIGINAL NOVEL · LONG OUTLINE"
        title="把已确认的故事圣经展开成长篇结构。"
        description="按卷与章节规划主线递进、角色目标、关键转折和章末钩子。候选可直接编辑、保存修订、回看历史，再通过人工门禁进入章节写作。"
        actions={
          <Badge
            tone={outlineStage?.status === 'accepted' ? 'green' : waiting ? 'gold' : 'blue'}
            dot
          >
            {status}
          </Badge>
        }
      />
      {stagesQuery.isError || jobsQuery.isError || briefQuery.isError || profilesQuery.isError ? (
        <div className="inline-notice" role="status">
          读取阶段、简报或任务数据失败。
          {stagesQuery.error?.message ??
            jobsQuery.error?.message ??
            briefQuery.error?.message ??
            profilesQuery.error?.message}
        </div>
      ) : null}
      <div className="original-outline-layout">
        <Panel className="outline-source-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACCEPTED STORY BIBLE</div>
              <h3>上游输入</h3>
              <p>只使用已验收版本；更新故事圣经后，当前大纲会变为过期并需重新生成。</p>
            </div>
            <Badge tone={storyBibleStage?.status === 'accepted' ? 'green' : 'gold'}>
              {storyBibleStage?.status === 'accepted' ? '已验收' : '未验收'}
            </Badge>
          </div>
          {storyBibleJob?.output?.content ? (
            <pre className="generation-output generation-output--document">
              {storyBibleJob.output.content}
            </pre>
          ) : (
            <div className="chapter-empty">
              <BookOpen size={18} />
              <b>尚无故事圣经候选</b>
              <small>先在“小说与创意”完成故事圣经生成和验收。</small>
            </div>
          )}
          <div className="outline-source-meta">
            <span>规划规模</span>
            <b>{briefQuery.data?.planned_scope ?? '尚未填写'}</b>
            <span>题材</span>
            <b>{briefQuery.data?.genre ?? project.genre ?? '未设'}</b>
          </div>
        </Panel>
        <Panel className="outline-generation-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">AI OUTLINE GENERATION</div>
              <h3>长篇大纲候选</h3>
              <p>生成将消耗所选服务额度；任务会保存输入快照、模型信息和用量。</p>
            </div>
            <Badge>
              {outlineJob?.output?.revision ? `v${outlineJob.output.revision}` : '未生成'}
            </Badge>
          </div>
          {canGenerate && (
            <div className="generation-launch">
              <Field label="文本服务">
                <SelectInput
                  value={profile?.id ?? ''}
                  disabled={outlineJob?.status === 'running' || generate.isPending}
                  onChange={(event) => {
                    idempotencyKey.current = '';
                    setSelectedProfileId(event.target.value);
                  }}
                >
                  <option value="">选择已测试连通的服务</option>
                  {textProfiles.map((item) => (
                    <option key={item.id} value={item.id} disabled={!item.enabled}>
                      {item.name} · {item.model_id}
                      {item.enabled ? '' : ' · 未通过连通检查'}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <label className="rights-checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={outlineJob?.status === 'running'}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  我授权本次将已验收故事圣经及规划信息发送给所选模型服务，生成长篇大纲候选。
                </span>
              </label>
              {profilesQuery.data && !textProfiles.length && (
                <div className="inline-notice">
                  请先在工作台设置中登记并测试 OpenAI 兼容文本服务。
                </div>
              )}
              <Button
                variant="primary"
                icon={<Sparkles size={14} />}
                disabled={generateDisabled}
                onClick={() => generate.mutate()}
              >
                {generate.isPending || outlineJob?.status === 'running'
                  ? '正在生成…'
                  : outlineJob?.status === 'failed'
                    ? '重试生成'
                    : '生成长篇大纲'}
              </Button>
              {generate.isError && (
                <p className="form-error" role="alert">
                  生成失败：{generate.error.message}
                </p>
              )}
              {outlineJob?.status === 'failed' && (
                <p className="form-error" role="alert">
                  最近一次任务失败：{String(outlineJob.error.code ?? 'provider_error')}
                </p>
              )}
            </div>
          )}
          {waiting && outlineJob && (
            <div className="generation-candidate">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">
                    {outlineJob.provider_snapshot.model_id as string} · REVISION{' '}
                    {outlineJob.output?.revision ?? 1}
                  </div>
                  <h3>大纲候选</h3>
                  <p>检查章节卡是否满足规模、因果推进和故事圣经约束。</p>
                </div>
                <Badge tone="gold" dot>
                  等待人工审阅
                </Badge>
              </div>
              <Field label="候选大纲">
                <TextArea
                  className="generation-output--document"
                  rows={22}
                  maxLength={2_000_000}
                  value={candidateContent}
                  onChange={(event) => setDraft({ key: candidateKey, content: event.target.value })}
                />
              </Field>
              {candidateContent !== outlineJob.output?.content && (
                <div className="inline-notice">有未保存修改；保存后才能验收或退回。</div>
              )}
              {versionsQuery.data && versionsQuery.data.length > 1 && (
                <div className="chapter-version-history">
                  <b>历史修订</b>
                  {versionsQuery.data.map((item) => (
                    <div key={item.revision}>
                      <span>
                        v{item.revision} · {new Date(item.created_at).toLocaleString()}
                      </span>
                      {item.revision === outlineJob.output?.revision ? (
                        <Badge tone="green">当前版本</Badge>
                      ) : (
                        <Button
                          size="sm"
                          disabled={saveCandidate.isPending || decide.isPending}
                          onClick={() => setDraft({ key: candidateKey, content: item.content })}
                        >
                          载入编辑区
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Field label="退回意见">
                <TextInput
                  value={candidateReason}
                  onChange={(event) => setCandidateReason(event.target.value)}
                  maxLength={1000}
                  placeholder="说明卷结构、章节功能或因果关系需要如何调整"
                />
              </Field>
              <div className="brief-actions">
                <Button
                  disabled={
                    candidateContent === outlineJob.output?.content ||
                    saveCandidate.isPending ||
                    decide.isPending
                  }
                  onClick={() => saveCandidate.mutate()}
                >
                  {saveCandidate.isPending ? '保存中…' : '保存候选修订'}
                </Button>
                <Button
                  variant="danger"
                  disabled={
                    !candidateReason.trim() ||
                    candidateContent !== outlineJob.output?.content ||
                    saveCandidate.isPending ||
                    decide.isPending
                  }
                  onClick={() => decide.mutate('reject')}
                >
                  退回重生成
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    candidateContent !== outlineJob.output?.content ||
                    saveCandidate.isPending ||
                    decide.isPending
                  }
                  onClick={() => decide.mutate('accept')}
                >
                  验收长篇大纲
                </Button>
              </div>
              {saveCandidate.isError && (
                <p className="form-error" role="alert">
                  修订保存失败：{saveCandidate.error.message}
                </p>
              )}
              {versionsQuery.isError && (
                <p className="form-error" role="alert">
                  版本读取失败：{versionsQuery.error.message}
                </p>
              )}
              {decide.isError && (
                <p className="form-error" role="alert">
                  阶段审核失败：{decide.error.message}
                </p>
              )}
            </div>
          )}
          {outlineStage?.status === 'accepted' && (
            <div className="inline-success">
              <Check size={15} />
              大纲已验收。进入章节写作前，还需验收文学角色圣经。
            </div>
          )}
          {outlineStage?.status === 'stale' && (
            <div className="inline-notice">
              故事圣经已变化；该大纲不能验收，请基于最新上游版本重新生成。
            </div>
          )}
          {!canGenerate && !waiting && outlineStage?.status !== 'accepted' && (
            <div className="chapter-empty">
              <ArrowRight size={18} />
              <b>等待上游门禁</b>
              <small>故事圣经验收后，此处才开放大纲生成。</small>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
