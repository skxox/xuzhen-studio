import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileCheck2, ShieldAlert, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  ContinuityFindingCard,
  type ContinuityFinding,
} from '../components/workspace/ContinuityFindingCard';
import { Field, SelectInput, TextArea } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project } from '../lib/types';

type Report = { chapter_start: number; chapter_end: number; findings: ContinuityFinding[] };

function parseReport(content?: string): Report | null {
  if (!content) return null;
  try {
    const value: unknown = JSON.parse(content);
    if (
      typeof value === 'object' &&
      value !== null &&
      'chapter_start' in value &&
      'chapter_end' in value &&
      'findings' in value &&
      typeof value.chapter_start === 'number' &&
      typeof value.chapter_end === 'number' &&
      Array.isArray(value.findings)
    ) {
      return value as Report;
    }
  } catch {
    return null;
  }
  return null;
}

export function OriginalContinuityWorkspace({ project }: { project?: Project }) {
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const idempotencyKey = useRef('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [consentGrant, setConsentGrant] = useState<{
    projectId?: string;
    value: boolean;
  }>({ value: false });
  const [chapterStart, setChapterStart] = useState(1);
  const [chapterEnd, setChapterEnd] = useState(2);
  const [riskAck, setRiskAck] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [reportEdit, setReportEdit] = useState<{ key: string; value: Report } | null>(null);

  const consent = consentGrant.projectId === projectId && consentGrant.value;
  const setConsent = (value: boolean) => setConsentGrant({ projectId, value });

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
      query.state.data?.some((job) => job.stage_key === 'continuity' && job.status === 'running')
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
  const continuityStage = stages.find((item) => item.stage_key === 'continuity');
  const releaseStage = stages.find((item) => item.stage_key === 'manuscriptRelease');
  const storyBibleStage = stages.find((item) => item.stage_key === 'storyBible');
  const outlineStage = stages.find((item) => item.stage_key === 'novelOutline');
  const characterStage = stages.find((item) => item.stage_key === 'literaryCharacters');
  const latestSuccessful = (key: string) =>
    jobs.find((job) => job.stage_key === key && job.status === 'succeeded');
  const storyBibleJob = latestSuccessful('storyBible');
  const outlineJob = latestSuccessful('novelOutline');
  const characterJob = latestSuccessful('literaryCharacters');
  const continuityJob = jobs.find((job) => job.stage_key === 'continuity');
  const chapterOrdinals = chapters.map((chapter) => chapter.ordinal);
  const chapterStartValue = chapterOrdinals.includes(chapterStart)
    ? chapterStart
    : (chapterOrdinals[0] ?? chapterStart);
  const chapterEndValue =
    chapterOrdinals.includes(chapterEnd) && chapterEnd >= chapterStartValue
      ? chapterEnd
      : (chapterOrdinals.filter((ordinal) => ordinal >= chapterStartValue).at(-1) ??
        chapterStartValue);
  const scopeChapters = chapters.filter(
    (chapter) => chapter.ordinal >= chapterStartValue && chapter.ordinal <= chapterEndValue,
  );
  const contextChapter = chapters.find((chapter) => chapter.ordinal === chapterStartValue - 1);
  const contiguous =
    scopeChapters.length === chapterEndValue - chapterStartValue + 1 &&
    chapterStartValue >= 1 &&
    chapterEndValue >= chapterStartValue &&
    (chapterStartValue === 1 || Boolean(contextChapter));
  const profileOptions = (profilesQuery.data ?? []).filter(
    (profile) => profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat',
  );
  const profile =
    profileOptions.find((item) => item.id === selectedProfileId && item.enabled) ??
    profileOptions.find((item) => item.enabled);
  const acceptedInputs = Boolean(
    storyBibleStage?.status === 'accepted' &&
    outlineStage?.status === 'accepted' &&
    characterStage?.status === 'accepted',
  );
  const candidate = parseReport(continuityJob?.output?.content);
  const candidateKey = `${continuityJob?.id ?? ''}:${continuityJob?.output?.revision ?? 0}`;
  const report = reportEdit?.key === candidateKey ? reportEdit.value : candidate;
  const unsaved = Boolean(
    report && candidate && JSON.stringify(report) !== JSON.stringify(candidate),
  );
  const isRunning = continuityStage?.status === 'running' || continuityJob?.status === 'running';
  const needsReview = continuityStage?.status === 'needs_review' && Boolean(candidate);
  const unresolvedHigh =
    report?.findings.filter(
      (finding) => finding.severity === 'high' && finding.status === 'open',
    ) ?? [];
  const unresolvedMedium =
    report?.findings.filter(
      (finding) => finding.severity === 'medium' && finding.status === 'open',
    ) ?? [];
  const missingResolution =
    report?.findings.filter(
      (finding) => finding.status !== 'open' && !finding.resolution_note.trim(),
    ) ?? [];
  const acceptedRisks =
    report?.findings.some((finding) => finding.status === 'accepted_risk') ?? false;
  const canAccept = Boolean(
    needsReview &&
    !unsaved &&
    !unresolvedHigh.length &&
    !missingResolution.length &&
    ((!unresolvedMedium.length && !acceptedRisks) || (riskAck && reviewReason.trim())),
  );

  const invalidate = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['jobs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['stages', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['chapters', projectId] }),
    ]);
  const generate = useMutation({
    mutationFn: async () => {
      if (
        !projectId ||
        !profile ||
        !storyBibleJob?.output ||
        !outlineJob?.output ||
        !characterJob?.output
      ) {
        throw new Error('需要先验收故事圣经、长篇大纲和文学角色圣经，并配置可用的文本服务。');
      }
      if (!consent) throw new Error('请先确认本次会将小说及创作依据发送给所选文本服务。');
      if (!contiguous || scopeChapters.length < 1)
        throw new Error('请选择连续且已保存的章节范围。');
      const prompt = [
        '你是长篇小说责任编辑，负责范围内的连续性审校。检查角色事实与知识边界、时间线、世界规则、因果、叙事视角、伏笔回收和跨章称谓。只报告能由本次章节原文定位的具体矛盾、缺口或高风险不一致；不要把文风偏好当作错误，也不要凭空补全未给出的事实。',
        '只输出 JSON，不要 Markdown 代码围栏。结构：{"chapter_start": number, "chapter_end": number, "findings": [{"finding_id":"稳定短ID","category":"character_fact|timeline|world_rule|causality|viewpoint|setup_payoff|other","severity":"high|medium|low","chapter_ordinal":number,"evidence_quote":"逐字引用对应章节原文","related_chapter_ordinal":number|null,"related_evidence_quote":string|null,"issue":"具体问题及矛盾双方","recommendation":"作者可执行的核对或修订建议","status":"open","resolution_note":""}]}。无可靠问题时 findings 输出空数组。所有引文必须逐字来自它所在的章节；跨章矛盾应给出两处证据。',
        `本次审校范围：第 ${chapterStartValue} 至第 ${chapterEndValue} 章。`,
        `故事圣经（已验收）：\n${storyBibleJob.output.content}`,
        `长篇大纲（已验收）：\n${outlineJob.output.content}`,
        `文学角色圣经（已验收）：\n${characterJob.output.content}`,
        ...(contextChapter
          ? [
              `上一章上下文（用于检查承接，不属于本次报告范围）：\n第 ${contextChapter.ordinal} 章《${contextChapter.title}》：\n${contextChapter.body}`,
            ]
          : []),
        ...scopeChapters.map(
          (chapter) => `第 ${chapter.ordinal} 章《${chapter.title}》：\n${chapter.body}`,
        ),
      ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('本次范围上下文超过文本服务限制，请缩小审校章节范围。');
      if (continuityStage?.status !== 'running') await api.startStage(projectId, 'continuity');
      const inputRefs = [
        storyBibleJob.id,
        outlineJob.id,
        characterJob.id,
        ...(contextChapter ? [contextChapter.id] : []),
        ...scopeChapters.map((chapter) => chapter.id),
      ];
      return api.createTextJob(projectId, {
        stage_key: 'continuity',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current || (idempotencyKey.current = crypto.randomUUID()),
        prompt,
        parameters: {
          temperature: 0.2,
          max_tokens: 10000,
          response_format: { type: 'json_object' },
        },
        input_refs: inputRefs,
        scope: {
          chapter_start: chapterStartValue,
          chapter_end: chapterEndValue,
          ...(contextChapter ? { context_chapter: contextChapter.ordinal } : {}),
        },
        data_authorized: consent,
      });
    },
    onSuccess: async (result) => {
      idempotencyKey.current = '';
      setConsent(false);
      setReportEdit(null);
      setRiskAck(false);
      setReviewReason('');
      await invalidate();
      if (result.status === 'running') idempotencyKey.current = '';
    },
    onError: async () => {
      idempotencyKey.current = '';
      await invalidate();
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateJobOutput(
        projectId!,
        continuityJob!.id,
        JSON.stringify(report),
        continuityJob!.output!.revision ?? 1,
      ),
    onSuccess: async () => {
      setReportEdit(null);
      await invalidate();
    },
  });
  const review = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        projectId!,
        'continuity',
        action,
        action === 'reject' ? reviewReason.trim() : reviewReason.trim() || undefined,
        riskAck,
      ),
    onSuccess: async () => {
      await invalidate();
      setReviewReason('');
      setRiskAck(false);
    },
  });
  const lockRelease = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('请先选择原创小说项目。');
      if (releaseStage?.status === 'accepted') return releaseStage;
      if (releaseStage?.status !== 'needs_review') {
        if (releaseStage?.status !== 'running')
          await api.startStage(projectId, 'manuscriptRelease');
        await api.submitStageReview(projectId, 'manuscriptRelease');
      }
      return api.decideStage(projectId, 'manuscriptRelease', 'accept');
    },
    onSuccess: invalidate,
  });

  const updateFinding = (findingId: string, update: Partial<ContinuityFinding>) => {
    if (!report) return;
    const next = {
      ...report,
      findings: report.findings.map((finding) =>
        finding.finding_id === findingId ? { ...finding, ...update } : finding,
      ),
    };
    setReportEdit({ key: candidateKey, value: next });
  };
  const taskError =
    continuityJob?.status === 'failed'
      ? String(continuityJob.error?.message ?? continuityJob.error?.code ?? '审校任务失败。')
      : '';
  const releaseSnapshot = releaseStage?.decision?.chapter_versions as
    Array<{ ordinal: number; chapter_id: string; version: number }> | undefined;

  if (project && project.creation_mode !== 'original') {
    return (
      <div className="writing-page">
        <PageHeading eyebrow="ORIGINAL NOVEL" title="连续性审校仅用于原创小说项目。" />
        <Link className="text-link" to="/writing">
          <ArrowLeft size={14} /> 返回故事与剧本
        </Link>
      </div>
    );
  }

  return (
    <div className="writing-page">
      <PageHeading
        eyebrow="ORIGINAL NOVEL · CONTINUITY REVIEW"
        title="连续性审校与范围锁版"
        description="AI 对选定章节范围提出带原文证据的问题；作者逐项处理，再对明确范围和章节版本做审阅锁定。"
        actions={
          <Badge
            tone={
              continuityStage?.status === 'accepted' ? 'green' : needsReview ? 'gold' : 'neutral'
            }
          >
            {continuityStage?.status === 'accepted'
              ? '审校已验收'
              : needsReview
                ? '待审阅'
                : isRunning
                  ? '审校中'
                  : '按范围审校'}
          </Badge>
        }
      />
      <div className="button-row">
        <Link className="text-link" to="/writing/chapters">
          <ArrowLeft size={14} /> 返回逐章正文
        </Link>
        <Link className="text-link" to="/canvas">
          查看流程画布
        </Link>
      </div>
      {!projectId ? (
        <Panel>
          <p>请先选择原创小说项目。</p>
        </Panel>
      ) : null}
      {taskError ? (
        <Panel>
          <p className="form-error">审校未产生有效报告：{taskError}</p>
        </Panel>
      ) : null}
      {generate.error || save.error || review.error || lockRelease.error ? (
        <Panel>
          <p className="form-error">
            {String(generate.error ?? save.error ?? review.error ?? lockRelease.error)}
          </p>
        </Panel>
      ) : null}

      <div className="workspace-grid workspace-grid--two">
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>审校范围与依据</h3>
              <p>一次最多审校 20 个连续章节；范围锁版只覆盖本次报告引用的章节版本。</p>
            </div>
          </div>
          <div className="form-stack">
            <div className="form-grid form-grid--two">
              <Field label="起始章节">
                <SelectInput
                  value={chapterStartValue}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setConsent(false);
                    setChapterStart(value);
                    if (chapterEnd < value) setChapterEnd(value);
                  }}
                  disabled={isRunning || needsReview}
                >
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.ordinal}>
                      第 {chapter.ordinal} 章
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="结束章节">
                <SelectInput
                  value={chapterEndValue}
                  onChange={(event) => {
                    setConsent(false);
                    setChapterEnd(Number(event.target.value));
                  }}
                  disabled={isRunning || needsReview}
                >
                  {chapters
                    .filter((chapter) => chapter.ordinal >= chapterStartValue)
                    .map((chapter) => (
                      <option key={chapter.id} value={chapter.ordinal}>
                        第 {chapter.ordinal} 章
                      </option>
                    ))}
                </SelectInput>
              </Field>
            </div>
            <div className="inline-note">
              <FileCheck2 size={16} />
              {chapters.length
                ? `范围内 ${scopeChapters.length} 章，${scopeChapters.reduce((total, chapter) => total + chapter.body.length, 0).toLocaleString()} 字；引用当前保存版本。`
                : '还没有验收章节；先完成逐章正文生成和验收。'}
            </div>
            {!chapters.length ? (
              <Link className="text-link" to="/writing/chapters">
                前往逐章正文工作台
              </Link>
            ) : null}
            <Field label="文本模型服务">
              <SelectInput
                value={profile?.id ?? ''}
                onChange={(event) => {
                  setConsent(false);
                  idempotencyKey.current = '';
                  setSelectedProfileId(event.target.value);
                }}
                disabled={isRunning}
              >
                <option value="">选择已连接的文本服务</option>
                {profileOptions.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.enabled}>
                    {item.name} · {item.model_id}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {!profile ? (
              <Link className="text-link" to="/settings">
                尚无可用文本服务，前往工作台设置
              </Link>
            ) : null}
            <div className="input-gate-list">
              {[
                ['故事圣经', storyBibleStage],
                ['长篇大纲', outlineStage],
                ['文学角色圣经', characterStage],
              ].map(([label, item]) => (
                <div className="input-gate-row" key={String(label)}>
                  <span>{String(label)}</span>
                  <Badge
                    tone={
                      (item as typeof storyBibleStage)?.status === 'accepted' ? 'green' : 'gold'
                    }
                  >
                    {(item as typeof storyBibleStage)?.status ?? '未开始'}
                  </Badge>
                </div>
              ))}
            </div>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={isRunning}
              />
              <span>
                我确认将选定章节、前一章上下文（如有）及已验收的故事圣经、大纲、文学角色资料发送给所选文本服务。
              </span>
            </label>
            <Button
              variant="primary"
              icon={<Sparkles size={16} />}
              disabled={
                !acceptedInputs ||
                !profile ||
                !consent ||
                !contiguous ||
                !scopeChapters.length ||
                needsReview ||
                isRunning
              }
              aria-busy={generate.isPending || isRunning}
              onClick={() => generate.mutate()}
            >
              {generate.isPending || isRunning ? '正在审校…' : '生成范围审校报告'}
            </Button>
            {!acceptedInputs ? (
              <p className="field-hint">故事圣经、大纲和文学角色圣经都通过门禁后才能审校。</p>
            ) : null}
          </div>
        </Panel>
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>范围结果</h3>
              <p>每条问题都必须引用对应章节的原文；后端会检查引文可定位。</p>
            </div>
            {report ? <Badge>{report.findings.length} 条问题</Badge> : null}
          </div>
          {report ? (
            <div className="continuity-summary">
              <span>
                <b>{unresolvedHigh.length}</b> 高风险待处理
              </span>
              <span>
                <b>{unresolvedMedium.length}</b> 中风险待确认
              </span>
              <span>
                <b>{report.findings.filter((finding) => finding.status === 'resolved').length}</b>{' '}
                已处理
              </span>
            </div>
          ) : (
            <div className="empty-state">
              <ShieldAlert size={20} />
              <p>选择连续章节范围，生成第一份带出处的审校报告。</p>
            </div>
          )}
        </Panel>
      </div>

      {report ? (
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>逐项审阅</h3>
              <p>高风险问题必须处理后才能接受；中风险未处理或接受风险时需填写理由并确认风险。</p>
            </div>
          </div>
          <div className="continuity-findings">
            {report.findings.length ? (
              report.findings.map((finding) => (
                <ContinuityFindingCard
                  finding={finding}
                  editable={needsReview}
                  key={finding.finding_id}
                  onUpdate={(update) => updateFinding(finding.finding_id, update)}
                />
              ))
            ) : (
              <div className="empty-state">
                <Check size={20} />
                <p>当前范围未发现可由原文证实的连续性问题。作者仍需检查并接受这份审校报告。</p>
              </div>
            )}
          </div>
          {needsReview ? (
            <div className="continuity-review-actions">
              <Field label="审校决定说明" hint="中风险未处理或接受风险时必填。">
                <TextArea
                  value={reviewReason}
                  onChange={(event) => setReviewReason(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="说明已处理项和仍保留风险的依据"
                />
              </Field>
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={riskAck}
                  onChange={(event) => setRiskAck(event.target.checked)}
                />
                <span>我已审阅未处理的中风险问题，并承担所记录的创作风险。</span>
              </label>
              <div className="button-row">
                <Button
                  disabled={!unsaved || Boolean(missingResolution.length) || save.isPending}
                  aria-busy={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? '正在保存…' : '保存处置'}
                </Button>
                <Button
                  variant="danger"
                  disabled={!reviewReason.trim() || review.isPending}
                  onClick={() => review.mutate('reject')}
                >
                  退回重新审校
                </Button>
                <Button
                  variant="primary"
                  icon={<Check size={15} />}
                  disabled={!canAccept || review.isPending}
                  aria-busy={review.isPending && review.variables === 'accept'}
                  onClick={() => review.mutate('accept')}
                >
                  {review.isPending && review.variables === 'accept' ? '正在验收…' : '验收审校报告'}
                </Button>
              </div>
              {unresolvedHigh.length ? (
                <p className="field-hint">
                  先处理所有高风险问题：
                  {unresolvedHigh.map((finding) => finding.finding_id).join('、')}
                </p>
              ) : null}
            </div>
          ) : null}
        </Panel>
      ) : null}

      {continuityStage?.status === 'accepted' ? (
        <Panel>
          <div className="panel-heading">
            <div>
              <h3>锁定审校范围</h3>
              <p>锁版会记录本报告范围内的章节 ID 和版本号；后续修改章节会让报告和锁版过期。</p>
            </div>
            <Badge tone={releaseStage?.status === 'accepted' ? 'green' : 'neutral'}>
              {releaseStage?.status === 'accepted' ? '范围已锁定' : '等待锁版'}
            </Badge>
          </div>
          {releaseStage?.status === 'accepted' && releaseSnapshot ? (
            <div className="inline-note">
              <FileCheck2 size={16} />
              已锁定第 {releaseStage.decision.chapter_start as number} 至第{' '}
              {releaseStage.decision.chapter_end as number} 章，共 {releaseSnapshot.length}{' '}
              个章节版本。锁定后仍可继续写新章节。
            </div>
          ) : (
            <div className="form-stack">
              <p className="field-hint">
                权利状态需先记录，且范围至少包含两章。
                {project?.rights_status === 'unconfirmed'
                  ? '当前权利状态仍未确认。'
                  : `当前权利状态：${project?.rights_status}。`}
              </p>
              {project?.rights_status === 'unconfirmed' ? (
                <Link className="text-link" to="/source">
                  前往权利与创意页登记权利状态
                </Link>
              ) : null}
              <Button
                variant="primary"
                icon={<FileCheck2 size={15} />}
                disabled={
                  project?.rights_status === 'unconfirmed' ||
                  (report?.chapter_end ?? 0) - (report?.chapter_start ?? 0) < 1 ||
                  !contiguous ||
                  lockRelease.isPending
                }
                aria-busy={lockRelease.isPending}
                onClick={() => lockRelease.mutate()}
              >
                {lockRelease.isPending ? '正在锁定…' : '锁定此章节范围'}
              </Button>
            </div>
          )}
          {releaseStage?.status === 'accepted' ? (
            <Link className="text-link" to="/source">
              返回原文与创意页 <ArrowLeft size={14} />
            </Link>
          ) : null}
        </Panel>
      ) : null}
      <div className="button-row">
        <Link className="text-link" to="/writing/chapters">
          <ArrowLeft size={14} /> 返回逐章正文
        </Link>
      </div>
    </div>
  );
}
