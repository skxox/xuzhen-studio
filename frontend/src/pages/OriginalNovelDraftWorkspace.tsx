import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Check, Clock3, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Chapter, Project } from '../lib/types';

type DraftCandidate = { ordinal: number; title: string; body: string };

function decodeCandidate(value: string): DraftCandidate | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'ordinal' in parsed &&
      'title' in parsed &&
      'body' in parsed &&
      typeof parsed.ordinal === 'number' &&
      typeof parsed.title === 'string' &&
      typeof parsed.body === 'string'
    ) {
      return parsed as DraftCandidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function OriginalNovelDraftWorkspace({ project }: { project?: Project }) {
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const idempotencyKey = useRef('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [ordinal, setOrdinal] = useState<number | ''>('');
  const [authorNote, setAuthorNote] = useState('');
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [bodyEdit, setBodyEdit] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [historyRevision, setHistoryRevision] = useState<number | null>(null);

  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId && project?.creation_mode === 'original'),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(projectId && project?.creation_mode === 'original'),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.stage_key === 'novelDraft' && job.status === 'running')
        ? 2500
        : false,
  });
  const chaptersQuery = useQuery({
    queryKey: ['chapters', projectId],
    queryFn: () => api.chapters(projectId!),
    enabled: Boolean(projectId && project?.creation_mode === 'original'),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId && project?.creation_mode === 'original'),
  });
  const stages = stagesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === 'novelDraft');
  const outlineStage = stages.find((item) => item.stage_key === 'novelOutline');
  const characterStage = stages.find((item) => item.stage_key === 'literaryCharacters');
  const outlineJob = jobs.find(
    (job) => job.stage_key === 'novelOutline' && job.status === 'succeeded',
  );
  const characterJob = jobs.find(
    (job) => job.stage_key === 'literaryCharacters' && job.status === 'succeeded',
  );
  const draftJob = jobs.find((job) => job.stage_key === 'novelDraft');
  const profileOptions = (profilesQuery.data ?? []).filter(
    (profile) => profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat',
  );
  const profile =
    profileOptions.find((item) => item.id === selectedProfileId && item.enabled) ??
    profileOptions.find((item) => item.enabled);
  const nextOrdinal = Math.max(0, ...chapters.map((chapter) => chapter.ordinal)) + 1;
  const targetOrdinal = ordinal || nextOrdinal;
  const previousChapter = chapters.find((chapter) => chapter.ordinal === targetOrdinal - 1);
  const currentCandidate = decodeCandidate(draftJob?.output?.content ?? '');
  const visibleCandidate = useMemo(() => {
    if (!currentCandidate) return null;
    return {
      ...currentCandidate,
      title: titleEdit ?? currentCandidate.title,
      body: bodyEdit ?? currentCandidate.body,
    };
  }, [currentCandidate, titleEdit, bodyEdit]);
  const versionsQuery = useQuery({
    queryKey: ['job-output-versions', projectId, draftJob?.id],
    queryFn: () => api.jobOutputVersions(projectId!, draftJob!.id),
    enabled: Boolean(projectId && draftJob?.output),
  });
  const historyCandidate =
    historyRevision === null
      ? null
      : decodeCandidate(
          versionsQuery.data?.find((item) => item.revision === historyRevision)?.content ?? '',
        );
  const validCandidate = Boolean(
    visibleCandidate &&
    visibleCandidate.ordinal ===
      Number(
        (draftJob?.input_snapshot?.scope as Record<string, unknown> | undefined)?.chapter_ordinal,
      ) &&
    visibleCandidate.title.trim() &&
    visibleCandidate.body.trim(),
  );
  const unsaved = Boolean(
    currentCandidate &&
    (visibleCandidate?.title !== currentCandidate.title ||
      visibleCandidate?.body !== currentCandidate.body),
  );

  const generate = useMutation({
    mutationFn: async () => {
      if (
        !projectId ||
        !profile ||
        !outlineJob?.output?.content ||
        !characterJob?.output?.content
      ) {
        throw new Error('需要先验收长篇大纲和文学角色圣经，并配置已测试的文本服务。');
      }
      if (!consent) throw new Error('请先确认本次会将创作资料发送到所选文本服务。');
      const target = Number(targetOrdinal);
      const prompt = [
        '你是长篇小说作者。请严格依据已验收的长篇大纲、文学角色圣经和连续性上下文，完成指定章节正文。遵循作者备注，但不可改写既定世界规则、角色事实或章节因果。',
        '只输出一个 JSON 对象，不要 Markdown 代码围栏或额外解释，格式为 {"ordinal": number, "title": string, "body": string}。正文必须完整、可读，不能写提纲或摘要。',
        `目标章节序号：${target}`,
        `作者备注：${authorNote.trim() || '无'}`,
        `已验收长篇大纲：\n${outlineJob.output.content}`,
        `已验收文学角色圣经：\n${characterJob.output.content}`,
        previousChapter
          ? `上一章正文（只用于承接，不要复述）：\n${previousChapter.body.slice(-18000)}`
          : '这是第一章，目前没有上一章正文。',
      ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('上下文超过单次任务长度限制，请缩短作者备注或上游资料。');
      if (stage?.status !== 'running') await api.startStage(projectId, 'novelDraft');
      return api.createTextJob(projectId, {
        stage_key: 'novelDraft',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current || (idempotencyKey.current = crypto.randomUUID()),
        prompt,
        parameters: {
          temperature: 0.7,
          max_tokens: 12000,
          response_format: { type: 'json_object' },
        },
        input_refs: [
          outlineJob.id,
          characterJob.id,
          ...(previousChapter ? [previousChapter.id] : []),
        ],
        scope: { chapter_ordinal: target },
        data_authorized: consent,
      });
    },
    onSuccess: async (result) => {
      setConsent(false);
      setTitleEdit(null);
      setBodyEdit(null);
      setHistoryRevision(null);
      if (result.status !== 'running') idempotencyKey.current = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      ]);
    },
    onError: async () => {
      idempotencyKey.current = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      ]);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        projectId!,
        draftJob!.id,
        JSON.stringify({
          ...visibleCandidate,
          title: visibleCandidate!.title.trim(),
          body: visibleCandidate!.body.trim(),
        }),
        draftJob!.output!.revision ?? 1,
      ),
    onSuccess: async () => {
      setTitleEdit(null);
      setBodyEdit(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
        queryClient.invalidateQueries({
          queryKey: ['job-output-versions', projectId, draftJob?.id],
        }),
      ]);
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        projectId!,
        'novelDraft',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReturnReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['chapters', projectId] }),
      ]);
    },
  });

  const upstreamAccepted =
    outlineStage?.status === 'accepted' && characterStage?.status === 'accepted';
  const isRunning = stage?.status === 'running' || draftJob?.status === 'running';
  const waitingReview = stage?.status === 'needs_review' && Boolean(currentCandidate);
  const errorText = String(generate.error ?? save.error ?? decide.error ?? '');
  const taskError =
    draftJob?.status === 'failed'
      ? String(
          draftJob.error?.message ?? draftJob.error?.code ?? '生成失败，请检查服务配置后重试。',
        )
      : '';
  if (project && project.creation_mode !== 'original') {
    return (
      <div className="writing-page">
        <PageHeading eyebrow="ORIGINAL NOVEL" title="逐章正文生成仅用于原创小说项目。" />
        <Link className="text-link" to="/writing">
          <ArrowLeft size={14} /> 返回故事与剧本
        </Link>
      </div>
    );
  }

  return (
    <div className="writing-page">
      <PageHeading
        eyebrow="ORIGINAL NOVEL · CHAPTER DRAFT"
        title="逐章正文工作台"
        description="AI 按章节生成可编辑候选；每章单独验收并保存版本，验收后进入连续性审校。"
        actions={
          <Badge tone={stage?.status === 'accepted' ? 'green' : waitingReview ? 'gold' : 'neutral'}>
            {stage?.status === 'accepted'
              ? '上一章已验收'
              : waitingReview
                ? '等待人工审阅'
                : isRunning
                  ? '生成中'
                  : '逐章控制'}
          </Badge>
        }
      />
      <Link className="text-link" to="/writing/characters">
        <ArrowLeft size={14} /> 返回文学角色圣经
      </Link>
      {!projectId ? (
        <Panel>
          <p>请先选择一个原创小说项目。</p>
        </Panel>
      ) : null}
      {stagesQuery.isError ||
      jobsQuery.isError ||
      chaptersQuery.isError ||
      profilesQuery.isError ? (
        <Panel>
          <p className="form-error">
            读取工作台数据失败：
            {String(
              stagesQuery.error ?? jobsQuery.error ?? chaptersQuery.error ?? profilesQuery.error,
            )}
          </p>
        </Panel>
      ) : null}
      {errorText ? (
        <Panel>
          <p className="form-error">{errorText}</p>
        </Panel>
      ) : null}
      {taskError ? (
        <Panel>
          <p className="form-error">本次章节任务未生成有效候选：{taskError}</p>
        </Panel>
      ) : null}
      <div className="workspace-grid workspace-grid--two">
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>本章生成</h3>
              <p>每次生成一个章节候选。上游门禁未通过时不可启动。</p>
            </div>
          </div>
          <div className="form-stack">
            <Field
              label="章节序号"
              hint={`默认下一章：第 ${nextOrdinal} 章；填写已有序号可生成修订版。`}
            >
              <TextInput
                type="number"
                min={1}
                value={ordinal || nextOrdinal}
                onChange={(event) =>
                  setOrdinal(event.target.value ? Number(event.target.value) : '')
                }
                disabled={isRunning || waitingReview}
              />
            </Field>
            <Field label="文本模型服务">
              <SelectInput
                value={profile?.id ?? ''}
                onChange={(event) => setSelectedProfileId(event.target.value)}
                disabled={isRunning}
              >
                <option value="">选择已连接的文本服务</option>
                {profileOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.model_id}
                    {item.enabled ? '' : '（未启用）'}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="作者备注" hint="只影响本次生成，不会自动改写已验收的大纲和角色圣经。">
              <TextArea
                value={authorNote}
                onChange={(event) => setAuthorNote(event.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="例如：本章重点呈现主角第一次违背家族规则的代价。"
                disabled={isRunning}
              />
            </Field>
            <div className="inline-note">
              <BookOpen size={16} />
              {previousChapter
                ? `连续性上下文：第 ${previousChapter.ordinal} 章《${previousChapter.title}》`
                : '连续性上下文：首章，无上一章正文'}
            </div>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={isRunning}
              />
              <span>我确认将已验收大纲、角色圣经和上一章正文（如有）发送给所选模型服务。</span>
            </label>
            <Button
              variant="primary"
              icon={<Sparkles size={16} />}
              aria-busy={generate.isPending || isRunning}
              disabled={!upstreamAccepted || !profile || !consent || waitingReview || isRunning}
              onClick={() => generate.mutate()}
            >
              {generate.isPending || isRunning ? '正在生成…' : `生成第 ${targetOrdinal} 章候选`}
            </Button>
            {!upstreamAccepted ? (
              <p className="field-hint">先验收长篇大纲和文学角色圣经，才能启动正文生成。</p>
            ) : null}
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>章节库存</h3>
              <p>每次验收会保存独立版本；后续重新生成同一章会递增版本号。</p>
            </div>
          </div>
          {chapters.length ? (
            <div className="chapter-list">
              {chapters.map((chapter: Chapter) => (
                <article className="chapter-list__item" key={chapter.id}>
                  <div>
                    <strong>
                      第 {chapter.ordinal} 章 · {chapter.title}
                    </strong>
                    <span>
                      版本 v{chapter.version} · {chapter.body.length.toLocaleString()} 字
                    </span>
                  </div>
                  <Badge tone="green">已验收</Badge>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <BookOpen size={22} />
              <p>尚无验收正文。生成并接受首章后会出现在这里。</p>
            </div>
          )}
        </Panel>
      </div>

      {currentCandidate ? (
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>第 {currentCandidate.ordinal} 章候选</h3>
              <p>编辑后先保存新修订，再提交验收。验收会原子化写入章节版本并推进阶段。</p>
            </div>
            <Badge tone={waitingReview ? 'gold' : 'neutral'}>
              {waitingReview ? '待审阅' : '候选'}
            </Badge>
          </div>
          <div className="draft-review-toolbar">
            <Field label="修订历史">
              <SelectInput
                value={historyRevision ?? ''}
                onChange={(event) =>
                  setHistoryRevision(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">当前候选 · v{draftJob?.output?.revision ?? 1}</option>
                {(versionsQuery.data ?? []).map((version) => (
                  <option value={version.revision} key={version.revision}>
                    修订 v{version.revision} · {new Date(version.created_at).toLocaleString()}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <div className="button-row">
              <Button
                disabled={!unsaved || !validCandidate || save.isPending || !waitingReview}
                aria-busy={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? '正在保存…' : '保存修订'}
              </Button>
              <Button
                variant="primary"
                icon={<Check size={15} />}
                disabled={
                  !waitingReview ||
                  !validCandidate ||
                  unsaved ||
                  Boolean(historyRevision) ||
                  decide.isPending
                }
                aria-busy={decide.isPending && decide.variables === 'accept'}
                onClick={() => decide.mutate('accept')}
              >
                {decide.isPending && decide.variables === 'accept' ? '正在验收…' : '验收并保存章节'}
              </Button>
            </div>
          </div>
          {historyRevision !== null ? (
            historyCandidate ? (
              <article className="draft-history-preview">
                <div className="inline-note">
                  <Clock3 size={15} />
                  修订 v{historyRevision} · 只读预览；切回当前候选后才能继续编辑和验收。
                </div>
                <h4>
                  第 {historyCandidate.ordinal} 章 · {historyCandidate.title}
                </h4>
                <pre>{historyCandidate.body}</pre>
              </article>
            ) : (
              <div className="inline-note">
                <Clock3 size={15} /> 此修订内容不是可识别的章节 JSON。
              </div>
            )
          ) : null}
          {historyRevision === null ? (
            <div className="form-stack">
              <Field label="章节标题">
                <TextInput
                  value={visibleCandidate?.title ?? ''}
                  onChange={(event) => setTitleEdit(event.target.value)}
                  maxLength={300}
                />
              </Field>
              <Field
                label="章节正文"
                hint={`${visibleCandidate?.body.length.toLocaleString() ?? 0} 字`}
              >
                <TextArea
                  className="novel-body-editor"
                  value={visibleCandidate?.body ?? ''}
                  onChange={(event) => setBodyEdit(event.target.value)}
                  rows={22}
                  maxLength={2_000_000}
                />
              </Field>
            </div>
          ) : null}
          {!validCandidate ? (
            <p className="field-hint">章节序号必须与生成任务一致，标题和正文不能为空。</p>
          ) : null}
          {waitingReview ? (
            <div className="return-review-row">
              <Field
                label="退回原因"
                hint="退回后可修改备注并重新生成；已验收的其他章节版本不会被删除。"
              >
                <TextInput
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  maxLength={1000}
                  placeholder="说明需要调整的内容"
                />
              </Field>
              <Button
                variant="danger"
                disabled={!returnReason.trim() || decide.isPending}
                aria-busy={decide.isPending && decide.variables === 'reject'}
                onClick={() => decide.mutate('reject')}
              >
                {decide.isPending && decide.variables === 'reject' ? '正在退回…' : '退回重写'}
              </Button>
            </div>
          ) : null}
        </Panel>
      ) : null}
      {outlineStage?.status === 'accepted' &&
      characterStage?.status === 'accepted' &&
      !currentCandidate &&
      stage?.status !== 'accepted' ? (
        <Panel>
          <p className="empty-state">
            上游资料已通过。选择文本服务、确认数据授权后，即可生成第 {nextOrdinal} 章。
          </p>
        </Panel>
      ) : null}
      <div className="button-row">
        <Link className="text-link" to="/writing">
          <ArrowLeft size={14} /> 返回故事与剧本
        </Link>
        <Link className="text-link" to="/canvas">
          查看生成流程画布
        </Link>
      </div>
    </div>
  );
}
