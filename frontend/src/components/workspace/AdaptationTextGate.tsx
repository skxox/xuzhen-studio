import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { Project } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../ui/Field';
import { Panel } from '../ui/Panel';

type GateKey = 'characters' | 'art';

export function AdaptationTextGate({ stageKey, project }: { stageKey: GateKey; project: Project }) {
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<{ key: string; content: string } | null>(null);
  const stagesQuery = useQuery({
    queryKey: ['stages', project.id],
    queryFn: () => api.stages(project.id),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', project.id],
    queryFn: () => api.jobs(project.id),
  });
  const branchesQuery = useQuery({
    queryKey: ['adaptation-branches', project.id],
    queryFn: () => api.adaptationBranches(project.id),
  });
  const outlinesQuery = useQuery({
    queryKey: ['adaptation-outlines', project.id],
    queryFn: () => api.adaptationOutlines(project.id),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', project.id],
    queryFn: () => api.serviceProfiles(project.id),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === stageKey);
  const outlineStage = stages.find((item) => item.stage_key === 'outline');
  const characterStage = stages.find((item) => item.stage_key === 'characters');
  const branch = branchesQuery.data?.find((item) => item.is_current);
  const outline = outlinesQuery.data?.find(
    (item) => item.is_current && item.branch_id === branch?.id,
  );
  const charactersJobId =
    typeof characterStage?.decision.candidate_job_id === 'string'
      ? characterStage.decision.candidate_job_id
      : '';
  const charactersJobQuery = useQuery({
    queryKey: ['job', project.id, charactersJobId],
    queryFn: () => api.job(project.id, charactersJobId),
    enabled: Boolean(
      stageKey === 'art' && charactersJobId && characterStage?.status === 'accepted',
    ),
  });
  const charactersJob = charactersJobQuery.data;
  const jobId =
    typeof stage?.decision.candidate_job_id === 'string' ? stage.decision.candidate_job_id : '';
  const acceptedJobQuery = useQuery({
    queryKey: ['job', project.id, jobId],
    queryFn: () => api.job(project.id, jobId),
    enabled: Boolean(jobId),
  });
  const latestJob = jobsQuery.data?.find((job) => job.stage_key === stageKey);
  const job = acceptedJobQuery.data ?? latestJob;
  const key = `${job?.id ?? ''}:${job?.output?.revision ?? 0}`;
  const candidateText = draft?.key === key ? draft.content : (job?.output?.content ?? '');
  const profiles = (profilesQuery.data ?? []).filter(
    (profile) =>
      profile.modality === 'text' &&
      profile.adapter_id === 'openai-compatible-chat' &&
      profile.enabled,
  );
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0];
  const needsReview = stage?.status === 'needs_review' && Boolean(job?.output?.content);
  const waiting = stage?.status === 'running' || job?.status === 'running';
  const saved = Boolean(job?.output && candidateText !== job.output.content);
  const prerequisites = Boolean(
    branch &&
    outline &&
    outlineStage?.status === 'accepted' &&
    (stageKey !== 'art' ||
      (characterStage?.status === 'accepted' && charactersJob?.output?.content)),
  );
  const label = stageKey === 'characters' ? '视频角色约束' : '美术设定';

  const refresh = async () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['jobs', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['job', project.id] }),
    ]);
  const generate = useMutation({
    mutationFn: async () => {
      if (!branch || !outline || !profile)
        throw new Error(`需要当前有效改编分支、已验收大纲和文本模型。`);
      if (stageKey === 'art' && !charactersJob?.output?.content)
        throw new Error('美术设定需引用当前已验收的视频角色约束。');
      const prompt =
        stageKey === 'characters'
          ? [
              '你是影视角色设计师。请根据已验收的分集改编大纲，输出供编剧、分镜和图像提示词使用的视频角色约束文档。使用结构清晰的 Markdown。',
              '逐一列出角色身份与剧中功能、外观识别锚点、年龄段与体态边界、服装/道具连续性、行为与表演边界、人物关系和本分支情绪弧、声音描述建议、跨集变化规则、不得擅自改变的事实和待作者确认项。角色名单须来自大纲场次，不能新增未授权角色；未明确的设定标为待确认。不要声称已生成图片或锁定视觉参考图。',
              `分支：${JSON.stringify({ id: branch.id, revision: branch.revision, outline_release_id: outline.id })}`,
              `已验收大纲：\n${JSON.stringify(outline)}`,
            ].join('\n\n')
          : [
              '你是影视美术指导。请基于已验收视频改编大纲和角色约束，输出供后续场景资产、道具和图像生成使用的美术圣经候选。使用结构清晰的 Markdown。',
              '包含全局视觉主张、色彩/材质/光线规则、年代与技术边界、场景资产清单（唯一名称、集/场引用、空间布局、可复用特征）、关键道具清单（用途、外观、状态连续性）、昼夜/天气视觉规则、跨场一致性检查表及待确认项。每个资产都须反向引用实际大纲场景；不要生成图片，也不要把推断写成已确认事实。',
              `分支：${JSON.stringify({ id: branch.id, revision: branch.revision, outline_release_id: outline.id })}`,
              `已验收大纲：\n${JSON.stringify(outline)}`,
              `已验收视频角色约束：\n${charactersJob!.output!.content}`,
            ].join('\n\n');
      if (prompt.length > 100_000)
        throw new Error('改编资料超过单次文本任务长度限制，请先精简上游大纲。');
      if (stage?.status !== 'running') await api.startStage(project.id, stageKey);
      const inputRefs = [
        branch.id,
        outline.id,
        outline.job_id,
        ...(stageKey === 'art' ? [charactersJob!.id] : []),
      ];
      idempotencyKey.current = crypto.randomUUID();
      return api.createTextJob(project.id, {
        stage_key: stageKey,
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt,
        parameters: { temperature: 0.35, max_tokens: 6000 },
        input_refs: inputRefs,
        scope: {
          branch_id: branch.id,
          outline_release_id: outline.id,
          ...(stageKey === 'art' ? { character_job_id: charactersJob!.id } : {}),
        },
        data_authorized: consent,
      });
    },
    onSuccess: async () => {
      setConsent(false);
      setDraft(null);
      await refresh();
    },
    onError: refresh,
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateJobOutput(project.id, job!.id, candidateText, job!.output!.revision ?? 1),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project.id,
        stageKey,
        action,
        action === 'reject' ? reason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReason('');
      await refresh();
    },
  });
  const accepted = stage?.status === 'accepted' && Boolean(acceptedJobQuery.data?.output?.content);

  return (
    <Panel className="adaptation-artifact-gate">
      <div className="panel-heading-row">
        <div>
          <div className="eyebrow">UPSTREAM REVIEW GATE</div>
          <h2>{label}</h2>
          <p>
            {stageKey === 'characters'
              ? '先由 AI 根据已验收大纲提出视频角色约束，再由作者审核确认。'
              : '角色约束通过后，AI 才能形成与分集场景对应的美术圣经候选。'}
          </p>
        </div>
        <Badge tone={accepted ? 'green' : needsReview ? 'gold' : waiting ? 'blue' : 'neutral'} dot>
          {accepted
            ? '已验收'
            : needsReview
              ? '待审阅'
              : waiting
                ? '生成中'
                : (stage?.status ?? '等待大纲')}
        </Badge>
      </div>
      {!prerequisites && (
        <p className="muted-copy">
          {stageKey === 'art' ? '先验收当前视频角色约束。' : '先验收当前改编分支和视频改编大纲。'}{' '}
          <Link to={stageKey === 'art' ? '/writing/script' : '/writing/adaptation-outline'}>
            查看上游
          </Link>
        </p>
      )}
      {prerequisites && (
        <div className="adaptation-artifact-controls">
          <Field label="文本模型">
            <SelectInput
              value={profile?.id ?? ''}
              disabled={waiting || needsReview}
              onChange={(event) => {
                setConsent(false);
                setProfileId(event.target.value);
              }}
            >
              <option value="">选择已启用的文本 API</option>
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.model_id}
                </option>
              ))}
            </SelectInput>
          </Field>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={waiting}
            />
            我确认将当前分支大纲{stageKey === 'art' ? '和已验收角色约束' : ''}
            发送至所选模型服务处理。
          </label>
          <div className="adaptation-artifact-buttons">
            <Button
              variant="primary"
              icon={<Sparkles size={14} />}
              disabled={!profile || !consent || waiting || needsReview}
              onClick={() => generate.mutate()}
            >
              {waiting ? '正在生成…' : accepted ? '重新生成候选' : `生成${label}候选`}
            </Button>
            {!profiles.length && (
              <Link className="text-link" to="/settings">
                配置文本模型
              </Link>
            )}
          </div>
          {generate.error && <p className="inline-error">{generate.error.message}</p>}
        </div>
      )}
      {job?.output?.content && (
        <div className="adaptation-artifact-review">
          {needsReview ? (
            <>
              <Field label={`${label}候选（支持直接编辑）`}>
                <TextArea
                  className="artifact-candidate-editor"
                  value={candidateText}
                  onChange={(event) => setDraft({ key, content: event.target.value })}
                />
              </Field>
              <div className="adaptation-artifact-buttons">
                <Field label="退回原因">
                  <TextInput
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="说明需要修订的内容"
                  />
                </Field>
                <Button disabled={!saved || save.isPending} onClick={() => save.mutate()}>
                  保存候选修改
                </Button>
                <Button
                  variant="primary"
                  icon={<Check size={14} />}
                  disabled={saved || decide.isPending}
                  onClick={() => decide.mutate('accept')}
                >
                  验收{label}
                </Button>
                <Button
                  variant="danger"
                  disabled={!reason.trim() || decide.isPending}
                  onClick={() => decide.mutate('reject')}
                >
                  退回重做
                </Button>
              </div>
            </>
          ) : accepted ? (
            <details className="accepted-artifact-preview">
              <summary>
                查看已验收版本 <ChevronDown size={13} />
              </summary>
              <pre>{acceptedJobQuery.data?.output?.content}</pre>
            </details>
          ) : null}
          {(save.error || decide.error) && (
            <p className="inline-error">{String(save.error ?? decide.error)}</p>
          )}
        </div>
      )}
    </Panel>
  );
}
