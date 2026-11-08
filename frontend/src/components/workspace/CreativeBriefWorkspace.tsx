export function CreativeBriefWorkspace({
  project,
  onSave,
}: {
  project?: Project;
  onSave: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [returnReason, setReturnReason] = useState('');
  const [candidateReason, setCandidateReason] = useState('');
  const [candidateDraft, setCandidateDraft] = useState<{ key: string; content: string } | null>(
    null,
  );
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [generationConsent, setGenerationConsent] = useState(false);
  const generationKey = useRef('');
  const briefQuery = useQuery({
    queryKey: ['creative-brief', project?.id],
    queryFn: () => api.creativeBrief(project!.id),
    enabled: Boolean(project?.id && project.creation_mode === 'original'),
    retry: false,
  });
  const stagesQuery = useQuery({
    queryKey: ['stages', project?.id],
    queryFn: () => api.stages(project!.id),
    enabled: Boolean(project?.id && project.creation_mode === 'original'),
    retry: false,
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', project?.id],
    queryFn: () => api.serviceProfiles(project!.id),
    enabled: Boolean(project?.id && project.creation_mode === 'original'),
    retry: false,
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', project?.id],
    queryFn: () => api.jobs(project!.id),
    enabled: Boolean(project?.id && project.creation_mode === 'original'),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.stage_key === 'storyBible' && job.status === 'running')
        ? 3000
        : false,
  });
  const stage = stagesQuery.data?.find((item) => item.stage_key === 'creativeBrief');
  const storyBibleStage = stagesQuery.data?.find((item) => item.stage_key === 'storyBible');
  const textProfiles =
    profilesQuery.data?.filter(
      (profile) => profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat',
    ) ?? [];
  const activeProfile =
    textProfiles.find((profile) => profile.id === selectedProfileId && profile.enabled) ??
    textProfiles.find((profile) => profile.enabled);
  const storyBibleJob = jobsQuery.data?.find((job) => job.stage_key === 'storyBible');
  const candidateDraftKey = `${storyBibleJob?.id ?? ''}:${storyBibleJob?.output?.revision ?? 0}`;
  const candidateContent =
    candidateDraft?.key === candidateDraftKey
      ? candidateDraft.content
      : (storyBibleJob?.output?.content ?? '');
  const candidateVersions = useQuery({
    queryKey: ['job-output-versions', project?.id, storyBibleJob?.id],
    queryFn: () => api.jobOutputVersions(project!.id, storyBibleJob!.id),
    enabled: Boolean(project?.id && storyBibleJob?.output),
  });
  const saveMutation = useMutation({
    mutationFn: (input: CreativeBriefSaveInput) => api.saveCreativeBrief(project!.id, input),
    onSuccess: async (brief) => {
      generationKey.current = '';
      queryClient.setQueryData(['creative-brief', project?.id], brief);
      await queryClient.invalidateQueries({ queryKey: ['stages', project?.id] });
      onSave(`创意简报已保存到项目 · 修订 v${String(brief.revision).padStart(2, '0')}。`);
    },
  });
  const submitReview = useMutation({
    mutationFn: () => api.submitStageReview(project!.id, 'creativeBrief'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['creative-brief', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
      ]);
      onSave('创意简报已提交审阅；审阅期间内容已锁定。');
    },
  });
  const decideReview = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project!.id,
        'creativeBrief',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async (result) => {
      setReturnReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['creative-brief', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
      ]);
      onSave(
        result.status === 'accepted'
          ? '创意简报已确认；可进入故事圣经阶段。'
          : '创意简报已退回修改，请按意见修订后重新提交。',
      );
    },
  });
  const generateStoryBible = useMutation({
    mutationFn: async () => {
      if (!project || !brief || !activeProfile) throw new Error('请先选择已测试连通的文本服务。');
      if (storyBibleStage?.status !== 'running') await api.startStage(project.id, 'storyBible');
      const prompt = [
        '你是长篇小说的策划编辑。请根据创意简报产出可供作者审阅的故事圣经候选。严格遵守简报边界，不得把推测写成既定事实。',
        '请使用 Markdown，依次提供：一句话核心、主题命题、世界规则、主线冲突引擎、主要角色目标与人物弧、关键关系、分卷推进、连续性风险、需要作者确认的问题。内容要具体可执行，避免空泛建议。',
        `题材：${brief.genre}`,
        `故事 premise：${brief.premise}`,
        `目标读者：${brief.target_readers}`,
        `叙事视角：${brief.narrative_pov}`,
        `规划规模：${brief.planned_scope}`,
        `风格基线：${brief.style_baseline}`,
        `创作约束：${brief.constraints || '无额外约束'}`,
      ].join('\n\n');
      return api.createTextJob(project.id, {
        stage_key: 'storyBible',
        profile_id: activeProfile.id,
        idempotency_key: generationKey.current || (generationKey.current = crypto.randomUUID()),
        prompt,
        parameters: { temperature: 0.7, max_tokens: 6000 },
        input_refs: [],
        data_authorized: generationConsent,
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['jobs', project?.id] }),
      ]);
      setGenerationConsent(false);
      if (result.status !== 'running') generationKey.current = '';
      onSave(
        result.status === 'succeeded'
          ? '故事圣经候选已生成，等待人工审阅。'
          : `生成任务状态：${result.status}${result.error?.code ? ` · ${String(result.error.code)}` : ''}`,
      );
    },
    onError: async (error) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['jobs', project?.id] }),
      ]);
      onSave(`生成失败：${error.message}`);
    },
  });
  const decideStoryBible = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project!.id,
        'storyBible',
        action,
        action === 'reject' ? candidateReason.trim() : undefined,
      ),
    onSuccess: async (result) => {
      setCandidateReason('');
      await queryClient.invalidateQueries({ queryKey: ['stages', project?.id] });
      onSave(
        result.status === 'accepted'
          ? '故事圣经候选已验收；长篇大纲与角色圣经阶段已解锁。'
          : '故事圣经候选已退回；修订提示后可重新生成。',
      );
    },
  });
  const saveCandidate = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        project!.id,
        storyBibleJob!.id,
        candidateContent,
        storyBibleJob!.output!.revision ?? 1,
      ),
    onSuccess: async (output) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
        queryClient.invalidateQueries({
          queryKey: ['job-output-versions', project?.id, storyBibleJob?.id],
        }),
      ]);
      onSave(`人工修订已保存 · 候选 v${output.revision}。`);
    },
  });
  if (briefQuery.isLoading && project?.id)
    return <div className="chapter-empty">正在读取项目创意简报…</div>;
  const brief = briefQuery.data;
  const canSave = Boolean(project?.id && project.creation_mode === 'original');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project?.id) return;
    const form = new FormData(event.currentTarget);
    saveMutation.mutate({
      premise: String(form.get('premise') ?? ''),
      genre: String(form.get('genre') ?? ''),
      target_readers: String(form.get('target_readers') ?? ''),
      narrative_pov: String(form.get('narrative_pov') ?? ''),
      planned_scope: String(form.get('planned_scope') ?? ''),
      style_baseline: String(form.get('style_baseline') ?? ''),
      constraints: String(form.get('constraints') ?? ''),
      rights_confirmed: form.get('rights_confirmed') === 'on',
    });
  };
  return (
    <div className="brief-grid">
      <Panel className="brief-form">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">
              CREATIVE BRIEF ·{' '}
              {brief ? `REVISION ${String(brief.revision).padStart(2, '0')}` : 'DRAFT'}
            </div>
            <h3>把创作边界讲清楚</h3>
            <p>简报保存到当前项目后，才能作为原创故事生成任务的输入。</p>
          </div>
          <Badge tone={brief ? 'blue' : 'gold'}>{brief ? '已保存草稿' : '未保存'}</Badge>
        </div>
        <form className="brief-form__fields" onSubmit={submit}>
          {project && project.creation_mode !== 'original' && (
            <div className="inline-notice">
              <BookOpen size={17} />
              <span>
                当前项目创建于“已有小说改编”入口。创意简报只保存到原创项目，请切换或新建原创项目。
              </span>
            </div>
          )}
          <fieldset
            className="brief-edit-fields"
            disabled={stage?.status === 'needs_review' || generateStoryBible.isPending}
          >
            <Field label="一句话故事 premise">
              <TextInput
                name="premise"
                required
                maxLength={3000}
                defaultValue={
                  brief?.premise ??
                  '南汀岛旧气象站封存前，档案修复员林澄在一场旧风暴的记录里发现被挪走的十一分钟。'
                }
              />
            </Field>
            <div className="form-row">
              <Field label="类型与子类型">
                <TextInput
                  name="genre"
                  required
                  maxLength={200}
                  defaultValue={brief?.genre ?? '海岛悬疑 · 现实群像'}
                />
              </Field>
              <Field label="目标读者">
                <TextInput
                  name="target_readers"
                  required
                  maxLength={1000}
                  defaultValue={
                    brief?.target_readers ?? '喜欢地方故事、档案谜题与克制关系线的成年读者'
                  }
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="叙事视角">
                <TextInput
                  name="narrative_pov"
                  required
                  maxLength={200}
                  defaultValue={brief?.narrative_pov ?? '第三人称限知 · 林澄视角'}
                />
              </Field>
              <Field label="规划规模">
                <TextInput
                  name="planned_scope"
                  required
                  maxLength={300}
                  defaultValue={brief?.planned_scope ?? '8 集短篇小说 · 每章约 2200 字'}
                />
              </Field>
            </div>
            <Field label="风格基线">
              <TextArea
                name="style_baseline"
                rows={3}
                required
                maxLength={3000}
                defaultValue={
                  brief?.style_baseline ??
                  '潮湿、安静、细节准确。谜题由仪器记录、档案版本和人物选择推进；不使用超自然解释。海岛生活有具体劳作与地方气候，不把居民写成背景奇观。'
                }
              />
            </Field>
            <Field label="不可写内容 / 约束">
              <TextArea
                name="constraints"
                rows={2}
                maxLength={3000}
                defaultValue={brief?.constraints ?? ''}
                placeholder="暴力尺度、禁用设定、必须保留的现实边界"
              />
            </Field>
            <label className="rights-checkbox">
              <input
                name="rights_confirmed"
                type="checkbox"
                defaultChecked={brief?.rights_confirmed ?? false}
              />
              <span>我确认拥有本原创设定与正文的创作权利，并可按项目授权给所选模型服务处理。</span>
            </label>
          </fieldset>
          {briefQuery.isError && (
            <p role="alert" className="form-error">
              读取简报失败：{briefQuery.error.message}
            </p>
          )}
          {stagesQuery.isError && (
            <p role="alert" className="form-error">
              读取阶段状态失败：{stagesQuery.error.message}
            </p>
          )}
          {saveMutation.isError && (
            <p role="alert" className="form-error">
              保存失败：{saveMutation.error.message}
            </p>
          )}
          {submitReview.isError && (
            <p role="alert" className="form-error">
              提交审阅失败：{submitReview.error.message}
            </p>
          )}
          {decideReview.isError && (
            <p role="alert" className="form-error">
              审阅操作失败：{decideReview.error.message}
            </p>
          )}
          <div className="brief-actions">
            <span>
              {stage?.status === 'accepted'
                ? '已确认 · 可开始故事圣经'
                : stage?.status === 'needs_review'
                  ? '等待作者确认'
                  : canSave
                    ? '草稿 · 保存后可提交审阅'
                    : '创建原创项目后可保存'}
            </span>
            {stage?.status === 'needs_review' ? (
              <>
                <Button
                  type="button"
                  variant="danger"
                  disabled={!returnReason.trim() || decideReview.isPending}
                  onClick={() => decideReview.mutate('reject')}
                >
                  退回修改
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={decideReview.isPending}
                  onClick={() => decideReview.mutate('accept')}
                >
                  确认简报
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={!canSave || saveMutation.isPending}>
                {saveMutation.isPending ? '正在保存…' : '保存简报'}
              </Button>
            )}
            {stage?.status === 'needs_review' && (
              <Field label="退回修改意见">
                <TextInput
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  maxLength={1000}
                  placeholder="说明需要修改的内容"
                />
              </Field>
            )}
            {stage?.status === 'running' && (
              <Button
                type="button"
                onClick={() => submitReview.mutate()}
                disabled={!brief?.rights_confirmed || submitReview.isPending}
                title={!brief?.rights_confirmed ? '请先确认权利声明并保存' : undefined}
              >
                {submitReview.isPending ? '正在提交…' : '提交作者确认'}
              </Button>
            )}
          </div>
          {stage?.status === 'accepted' && storyBibleStage?.status !== 'needs_review' && (
            <section className="generation-launch">
              <div>
                <b>生成故事圣经候选</b>
                <small>
                  将已确认的创意简报发送到你选择的文本服务；返回内容会作为候选保存，等待人工验收。
                </small>
              </div>
              <Field label="文本服务">
                <SelectInput
                  value={activeProfile?.id ?? ''}
                  disabled={storyBibleJob?.status === 'running' || generateStoryBible.isPending}
                  onChange={(event) => {
                    generationKey.current = '';
                    setSelectedProfileId(event.target.value);
                  }}
                >
                  <option value="">选择已测试连通的服务</option>
                  {textProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id} disabled={!profile.enabled}>
                      {profile.name} · {profile.model_id}
                      {profile.enabled ? '' : ' · 未通过连通检查'}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <label className="rights-checkbox">
                <input
                  type="checkbox"
                  checked={generationConsent}
                  onChange={(event) => setGenerationConsent(event.target.checked)}
                />
                <span>我授权本次将已确认的创意简报发送给所选模型服务，用于生成故事圣经候选。</span>
              </label>
              {profilesQuery.isError && (
                <p className="form-error" role="alert">
                  读取模型服务失败：{profilesQuery.error.message}
                </p>
              )}
              {profilesQuery.data && !textProfiles.length && (
                <p className="inline-notice">请先在工作台设置中添加 OpenAI 兼容文本服务。</p>
              )}
              {generateStoryBible.isError && (
                <p className="form-error" role="alert">
                  生成请求失败：{generateStoryBible.error.message}
                </p>
              )}
              <Button
                type="button"
                variant="primary"
                icon={<Sparkles size={14} />}
                disabled={
                  !activeProfile ||
                  !generationConsent ||
                  !brief?.rights_confirmed ||
                  storyBibleJob?.status === 'running' ||
                  generateStoryBible.isPending
                }
                onClick={() => generateStoryBible.mutate()}
              >
                {generateStoryBible.isPending || storyBibleJob?.status === 'running'
                  ? '正在请求模型…'
                  : storyBibleJob?.status === 'failed'
                    ? '重试生成'
                    : '生成故事圣经候选'}
              </Button>
            </section>
          )}
          {storyBibleStage?.status === 'needs_review' && storyBibleJob?.output && (
            <StoryBibleCandidateReview
              modelId={String(storyBibleJob.provider_snapshot.model_id ?? '未知模型')}
              revision={storyBibleJob.output.revision ?? 1}
              savedContent={storyBibleJob.output.content}
              content={candidateContent}
              versions={candidateVersions.data ?? []}
              candidateReason={candidateReason}
              isSaving={saveCandidate.isPending}
              isDeciding={decideStoryBible.isPending}
              saveError={saveCandidate.isError ? saveCandidate.error.message : undefined}
              versionsError={
                candidateVersions.isError ? candidateVersions.error.message : undefined
              }
              decisionError={decideStoryBible.isError ? decideStoryBible.error.message : undefined}
              onContentChange={(content) => setCandidateDraft({ key: candidateDraftKey, content })}
              onReasonChange={setCandidateReason}
              onSave={() => saveCandidate.mutate()}
              onAccept={() => decideStoryBible.mutate('accept')}
              onReject={() => decideStoryBible.mutate('reject')}
            />
          )}
          {storyBibleJob?.status === 'failed' && (
            <p className="form-error" role="alert">
              最近生成失败：{String(storyBibleJob.error.code ?? 'provider_error')}
              。检查服务配置后可重试。
            </p>
          )}
        </form>
      </Panel>
      <Panel className="brief-preview">
        <div className="eyebrow">AI WILL DEVELOP</div>
        <h3>下一步会发生什么</h3>
        <div className="brief-preview__item">
          <span>01</span>
          <b>故事核心与冲突引擎</b>
          <small>角色目标、阻碍、代价与因果钩子</small>
        </div>
        <div className="brief-preview__item">
          <span>02</span>
          <b>世界规则与人物圣经</b>
          <small>故事规则、关系弧、人物行为边界</small>
        </div>
        <div className="brief-preview__item">
          <span>03</span>
          <b>分卷 / 分集 / 章节大纲</b>
          <small>章节卡有目标、冲突、转折与钩子</small>
        </div>
        <div className="note-box">
          <ShieldCheck size={15} />
          所有内容先作为候选；逐项接受后才会进入章节生成上下文。
        </div>
      </Panel>
    </div>
  );
}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { BookOpen, ShieldCheck, Sparkles } from 'lucide-react';
import type { CreativeBriefSaveInput, Project } from '../../lib/types';
import { api } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../ui/Field';
import { Panel } from '../ui/Panel';
import { StoryBibleCandidateReview } from './StoryBibleCandidateReview';
