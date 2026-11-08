import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Check, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project } from '../lib/types';

export function OriginalLiteraryCharactersWorkspace({ project }: { project?: Project }) {
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; content: string } | null>(null);
  const idempotencyKey = useRef('');
  const projectId = project?.id;
  const isOriginal = project?.creation_mode === 'original';

  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(isOriginal && projectId),
    retry: false,
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(isOriginal && projectId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some(
        (job) => job.stage_key === 'literaryCharacters' && job.status === 'running',
      )
        ? 3000
        : false,
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(isOriginal && projectId),
    retry: false,
  });
  const stages = stagesQuery.data ?? [];
  const storyBibleStage = stages.find((stage) => stage.stage_key === 'storyBible');
  const outlineStage = stages.find((stage) => stage.stage_key === 'novelOutline');
  const characterStage = stages.find((stage) => stage.stage_key === 'literaryCharacters');
  const storyBibleJob = jobsQuery.data?.find((job) => job.stage_key === 'storyBible');
  const outlineJob = jobsQuery.data?.find((job) => job.stage_key === 'novelOutline');
  const characterJob = jobsQuery.data?.find((job) => job.stage_key === 'literaryCharacters');
  const textProfiles =
    profilesQuery.data?.filter(
      (profile) => profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat',
    ) ?? [];
  const profile =
    textProfiles.find((item) => item.id === selectedProfileId && item.enabled) ??
    textProfiles.find((item) => item.enabled);
  const candidateKey = `${characterJob?.id ?? ''}:${characterJob?.output?.revision ?? 0}`;
  const candidateContent =
    draft?.key === candidateKey ? draft.content : (characterJob?.output?.content ?? '');
  const versionsQuery = useQuery({
    queryKey: ['job-output-versions', projectId, characterJob?.id],
    queryFn: () => api.jobOutputVersions(projectId!, characterJob!.id),
    enabled: Boolean(projectId && characterJob?.output),
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (
        !projectId ||
        !profile ||
        !storyBibleJob?.output?.content ||
        !outlineJob?.output?.content
      ) {
        throw new Error('需要已验收的故事圣经、长篇大纲和已测试连通的文本服务。');
      }
      const prompt = [
        '你是长篇小说的人物编辑。请基于已验收的故事圣经和长篇大纲，编制可用于连续章节写作的文学角色圣经候选。不得把推断当作已确认事实；冲突信息需列为作者待确认项。',
        '使用 Markdown。先列人物关系总表，再逐个角色给出：姓名与身份、故事功能、外在目标、内在需求、核心恐惧或旧伤、优势与缺陷、价值观冲突、人物弧起点与终点、关键转变条件、说话节奏与用词边界、关系变化、不可擅自改变的事实、出场卷章、与大纲事件的因果连接、连续性检查项。配角也需有独立目标，避免仅作为剧情工具人。最后列出冲突设定和需要作者决策的问题。',
        '已验收故事圣经：',
        storyBibleJob.output.content,
        '已验收长篇大纲：',
        outlineJob.output.content,
      ].join('\n\n');
      if (prompt.length > 100_000) {
        throw new Error('上游内容过长，超过单次文本任务上限；请先精简已验收的大纲或拆分人物范围。');
      }
      if (characterStage?.status !== 'running') {
        await api.startStage(projectId, 'literaryCharacters');
      }
      return api.createTextJob(projectId, {
        stage_key: 'literaryCharacters',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current || (idempotencyKey.current = crypto.randomUUID()),
        prompt,
        parameters: { temperature: 0.55, max_tokens: 8000 },
        input_refs: [storyBibleJob.id, outlineJob.id],
        data_authorized: consent,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      ]);
      setConsent(false);
      if (result.status !== 'running') idempotencyKey.current = '';
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      ]);
    },
  });
  const saveCandidate = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        projectId!,
        characterJob!.id,
        candidateContent,
        characterJob!.output!.revision ?? 1,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['job-output-versions', projectId, characterJob?.id],
        }),
      ]);
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        projectId!,
        'literaryCharacters',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReturnReason('');
      await queryClient.invalidateQueries({ queryKey: ['stages', projectId] });
    },
  });

  const acceptedUpstream =
    storyBibleStage?.status === 'accepted' && outlineStage?.status === 'accepted';
  const waiting =
    characterStage?.status === 'needs_review' && Boolean(characterJob?.output?.content);
  const canGenerate = Boolean(acceptedUpstream && characterStage?.status !== 'needs_review');
  const isRunning = characterJob?.status === 'running' || characterStage?.status === 'running';
  const statusLabel =
    characterStage?.status === 'accepted'
      ? '已验收'
      : waiting
        ? '待审阅'
        : isRunning
          ? '生成中'
          : characterStage?.status === 'failed'
            ? '生成失败'
            : characterStage?.status === 'stale'
              ? '已过期'
              : acceptedUpstream
                ? '可开始'
                : '等待上游门禁';

  if (project && !isOriginal) {
    return (
      <div className="writing-page">
        <PageHeading eyebrow="ORIGINAL NOVEL" title="文学角色圣经仅用于原创小说项目。" />
        <Link className="text-link" to="/writing">
          <ArrowLeft size={14} /> 返回故事与剧本
        </Link>
      </div>
    );
  }

  return (
    <div className="writing-page original-outline-page">
      <PageHeading
        eyebrow="ORIGINAL NOVEL · LITERARY CHARACTERS"
        title="让人物在长篇推进中保持自己的目标与变化。"
        description="从已验收的故事圣经和长篇大纲生成文学角色圣经。逐人检查人物弧、关系与连续性，再审阅、修订并验收。"
        actions={
          <Badge
            tone={characterStage?.status === 'accepted' ? 'green' : waiting ? 'gold' : 'blue'}
            dot
          >
            {statusLabel}
          </Badge>
        }
      />
      {(stagesQuery.isError || jobsQuery.isError || profilesQuery.isError) && (
        <div className="inline-notice" role="alert">
          读取项目阶段、任务或文本服务失败：
          {stagesQuery.error?.message ?? jobsQuery.error?.message ?? profilesQuery.error?.message}
        </div>
      )}
      {!projectId && (
        <div className="inline-notice">先创建或选择原创小说项目，再开始角色规划。</div>
      )}
      <div className="original-outline-layout">
        <Panel className="outline-source-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACCEPTED INPUTS</div>
              <h3>写作依据</h3>
              <p>生成任务会固定引用这两个已验收版本；上游更新后，角色圣经会过期并要求重审。</p>
            </div>
            <Badge tone={acceptedUpstream ? 'green' : 'gold'}>
              {acceptedUpstream ? '上游已验收' : '等待验收'}
            </Badge>
          </div>
          <div className="chapter-empty">
            <BookOpen size={18} />
            <b>故事圣经 · {storyBibleStage?.status ?? '未开始'}</b>
            <small>
              {storyBibleJob?.output?.content
                ? '已保存角色、世界和冲突依据。'
                : '请先完成故事圣经。'}
            </small>
          </div>
          <div className="chapter-empty">
            <BookOpen size={18} />
            <b>长篇大纲 · {outlineStage?.status ?? '未开始'}</b>
            <small>
              {outlineJob?.output?.content
                ? '已保存分卷与章节卡依据。'
                : '请先生成并验收长篇大纲。'}
            </small>
          </div>
          <Link className="text-link" to="/writing">
            <ArrowLeft size={14} /> 返回长篇大纲
          </Link>
          {characterStage?.status === 'accepted' && (
            <Link className="text-link" to="/writing/chapters">
              <Sparkles size={14} /> 前往逐章正文工作台
            </Link>
          )}
        </Panel>
        <Panel className="outline-generation-card">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">AI CHARACTER BIBLE</div>
              <h3>文学角色圣经</h3>
              <p>人物目标、关系弧和出场依据会作为分批正文的稳定上下文。</p>
            </div>
            <Badge>
              {characterJob?.output?.revision ? `v${characterJob.output.revision}` : '未生成'}
            </Badge>
          </div>
          {canGenerate && (
            <div className="generation-launch">
              <Field label="文本服务">
                <SelectInput
                  value={profile?.id ?? ''}
                  disabled={isRunning || generate.isPending}
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
                  disabled={isRunning}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  我授权本次将已验收的故事圣经和大纲发送给所选模型服务，用于生成人物候选。
                </span>
              </label>
              {profilesQuery.data && !textProfiles.length && (
                <div className="inline-notice">
                  请先在工作台设置中添加并测试 OpenAI 兼容文本服务。
                </div>
              )}
              <Button
                variant="primary"
                icon={<Sparkles size={14} />}
                disabled={
                  !profile || !consent || !acceptedUpstream || generate.isPending || isRunning
                }
                onClick={() => generate.mutate()}
              >
                {isRunning || generate.isPending ? '正在生成…' : '生成人物圣经候选'}
              </Button>
              {generate.isError && (
                <p className="form-error" role="alert">
                  生成请求失败：{generate.error.message}
                </p>
              )}
            </div>
          )}
          {waiting && characterJob?.output && (
            <div className="generation-candidate">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">
                    {String(characterJob.provider_snapshot.model_id ?? '未知模型')} · REVISION{' '}
                    {characterJob.output.revision ?? 1}
                  </div>
                  <h3>人物候选</h3>
                  <p>检查每个人物是否有独立目标，人物变化是否与已验收大纲的事件因果一致。</p>
                </div>
                <Badge tone="gold" dot>
                  等待人工审阅
                </Badge>
              </div>
              <Field label="角色圣经候选">
                <TextArea
                  className="generation-output--document"
                  rows={22}
                  maxLength={2_000_000}
                  value={candidateContent}
                  onChange={(event) => setDraft({ key: candidateKey, content: event.target.value })}
                />
              </Field>
              {candidateContent !== characterJob.output.content && (
                <div className="inline-notice">有未保存的修改；保存后才能验收或退回。</div>
              )}
              {versionsQuery.data && versionsQuery.data.length > 1 && (
                <div className="chapter-version-history">
                  <b>修订历史</b>
                  {versionsQuery.data.map((version) => (
                    <div key={version.revision}>
                      <span>
                        v{version.revision} · {new Date(version.created_at).toLocaleString()}
                      </span>
                      {version.revision === characterJob.output?.revision ? (
                        <Badge tone="green">当前版本</Badge>
                      ) : (
                        <Button
                          size="sm"
                          disabled={saveCandidate.isPending || decide.isPending}
                          onClick={() => setDraft({ key: candidateKey, content: version.content })}
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
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  maxLength={1000}
                  placeholder="说明哪些人物弧、关系或连续性需要调整"
                />
              </Field>
              <div className="brief-actions">
                <Button
                  disabled={
                    candidateContent === characterJob.output.content ||
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
                    !returnReason.trim() ||
                    candidateContent !== characterJob.output.content ||
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
                    candidateContent !== characterJob.output.content ||
                    saveCandidate.isPending ||
                    decide.isPending
                  }
                  onClick={() => decide.mutate('accept')}
                >
                  验收文学角色圣经
                </Button>
              </div>
              {saveCandidate.isError && (
                <p className="form-error" role="alert">
                  保存失败：{saveCandidate.error.message}
                </p>
              )}
              {versionsQuery.isError && (
                <p className="form-error" role="alert">
                  读取修订历史失败：{versionsQuery.error.message}
                </p>
              )}
              {decide.isError && (
                <p className="form-error" role="alert">
                  阶段审核失败：{decide.error.message}
                </p>
              )}
            </div>
          )}
          {characterStage?.status === 'accepted' && (
            <div className="inline-success">
              <Check size={15} />
              文学角色圣经已验收，原创正文阶段的角色门禁已满足。
            </div>
          )}
          {characterStage?.status === 'stale' && (
            <div className="inline-notice">
              故事圣经或大纲已变化；请基于最新验收版本重新生成角色圣经。
            </div>
          )}
          {characterJob?.status === 'failed' && (
            <p className="form-error" role="alert">
              最近生成失败：{String(characterJob.error.code ?? 'provider_error')}
            </p>
          )}
          {!acceptedUpstream && (
            <div className="chapter-empty">
              <b>上游阶段尚未验收</b>
              <small>必须先验收故事圣经和长篇大纲；正在运行的任务也不会解锁本阶段。</small>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
