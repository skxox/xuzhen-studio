export function CommercialBriefWorkspace({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [returnReason, setReturnReason] = useState('');
  const [notice, setNotice] = useState('');
  const [materialRights, setMaterialRights] =
    useState<CommercialMaterial['rights_status']>('owned');
  const materialInput = useRef<HTMLInputElement>(null);
  const briefQuery = useQuery({
    queryKey: ['commercial-brief', project.id],
    queryFn: () => api.commercialBrief(project.id),
    retry: false,
  });
  const materialsQuery = useQuery({
    queryKey: ['commercial-materials', project.id],
    queryFn: () => api.commercialMaterials(project.id),
    retry: false,
  });
  const stagesQuery = useQuery({
    queryKey: ['stages', project.id],
    queryFn: () => api.stages(project.id),
    retry: false,
  });
  const stage = stagesQuery.data?.find((item) => item.stage_key === 'commercialBrief');
  const save = useMutation({
    mutationFn: (body: CommercialBriefSaveInput) => api.saveCommercialBrief(project.id, body),
    onSuccess: async (brief) => {
      queryClient.setQueryData(['commercial-brief', project.id], brief);
      await queryClient.invalidateQueries({ queryKey: ['stages', project.id] });
      setNotice(`商品简报已保存 · 修订 v${String(brief.revision).padStart(2, '0')}。`);
    },
  });
  const uploadMaterial = useMutation({
    mutationFn: (file: File) => api.uploadCommercialMaterial(project.id, file, materialRights),
    onSuccess: async (material) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commercial-materials', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      ]);
      setNotice(`已登记素材「${material.original_name}」；授权状态和 SHA-256 已保存。`);
    },
  });
  const submitReview = useMutation({
    mutationFn: () => api.submitStageReview(project.id, 'commercialBrief'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      ]);
      setNotice('商品简报已提交审核；当前版本已锁定。');
    },
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project.id,
        'commercialBrief',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async (result) => {
      setReturnReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
      ]);
      setNotice(
        result.status === 'accepted'
          ? '商品事实已确认；改编大纲阶段已解锁。'
          : '商品简报已退回，请按审核意见修订。',
      );
    },
  });
  const brief = briefQuery.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = (key: string) =>
      String(form.get(key) ?? '')
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
    save.mutate({
      product_name: String(form.get('product_name') ?? ''),
      category: String(form.get('category') ?? ''),
      product_facts: String(form.get('product_facts') ?? ''),
      target_audience: String(form.get('target_audience') ?? ''),
      selling_points: lines('selling_points'),
      approved_claims: lines('approved_claims'),
      prohibited_claims: lines('prohibited_claims'),
      call_to_action: String(form.get('call_to_action') ?? ''),
      distribution_channel: String(form.get('distribution_channel') ?? ''),
      target_seconds: Number(form.get('target_seconds')),
      rights_confirmed: form.get('rights_confirmed') === 'on',
    });
  };
  if (briefQuery.isLoading) return <div className="chapter-empty">正在读取商品简报…</div>;
  const locked = stage?.status === 'needs_review';
  return (
    <div className="source-page">
      <PageHeading
        eyebrow="COMMERCIAL PRODUCTION"
        title="先确认产品事实，再规划广告短片。"
        description="明确受众、卖点、可用证据和禁用承诺；审核通过后才解锁大纲与共用视频制作阶段。"
        actions={
          <Badge tone={stage?.status === 'accepted' ? 'green' : 'gold'} dot>
            {stage?.status === 'accepted'
              ? '商品简报已确认'
              : stage?.status === 'needs_review'
                ? '等待人工审核'
                : '产品信息待确认'}
          </Badge>
        }
      />
      <div className="commercial-brief-layout">
        <Panel className="brief-form">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">
                PRODUCT FACTS ·{' '}
                {brief ? `REVISION ${String(brief.revision).padStart(2, '0')}` : 'DRAFT'}
              </div>
              <h3>商品与素材简报</h3>
              <p>结构化记录将成为后续脚本生成的约束和审阅依据。</p>
            </div>
            <Badge tone={brief ? 'blue' : 'neutral'}>{brief?.status ?? '未保存'}</Badge>
          </div>
          <form className="brief-form__fields" onSubmit={submit}>
            <fieldset className="commercial-brief-fields" disabled={locked}>
              <div className="form-row">
                <Field label="商品名称">
                  <TextInput
                    name="product_name"
                    required
                    maxLength={200}
                    defaultValue={brief?.product_name ?? ''}
                    placeholder="例如：轻量通勤保温杯"
                  />
                </Field>
                <Field label="品类">
                  <TextInput
                    name="category"
                    required
                    maxLength={200}
                    defaultValue={brief?.category ?? ''}
                    placeholder="例如：户外饮具"
                  />
                </Field>
              </div>
              <Field
                label="产品事实与可验证规格"
                hint="只写有依据的材料、容量、检测信息等；不要把推断写成事实。"
              >
                <TextArea
                  name="product_facts"
                  required
                  rows={3}
                  maxLength={5000}
                  defaultValue={brief?.product_facts ?? ''}
                  placeholder="材质、尺寸、功能、适用条件、证据来源……"
                />
              </Field>
              <Field label="目标受众">
                <TextArea
                  name="target_audience"
                  required
                  rows={2}
                  maxLength={2000}
                  defaultValue={brief?.target_audience ?? ''}
                  placeholder="受众场景、需求和购买顾虑"
                />
              </Field>
              <Field label="核心卖点" hint="每行一项；后续脚本按已审核的卖点取舍。">
                <TextArea
                  name="selling_points"
                  required
                  rows={3}
                  defaultValue={brief?.selling_points.join('\n') ?? ''}
                  placeholder="轻便，适合日常通勤\n杯盖可拆洗"
                />
              </Field>
              <div className="form-row">
                <Field label="允许使用的宣传语 / 证据">
                  <TextArea
                    name="approved_claims"
                    rows={3}
                    defaultValue={brief?.approved_claims.join('\n') ?? ''}
                    placeholder="每行一项；附上可支持该表述的证据"
                  />
                </Field>
                <Field label="禁止或高风险宣传语">
                  <TextArea
                    name="prohibited_claims"
                    rows={3}
                    defaultValue={brief?.prohibited_claims.join('\n') ?? ''}
                    placeholder="每行一项；包括不能保证的效果与绝对化用语"
                  />
                </Field>
              </div>
              <section className="commercial-materials">
                <div className="commercial-materials__heading">
                  <div>
                    <b>商品素材</b>
                    <small>图片、视频或说明文件；每项单独记录使用权状态与文件校验哈希。</small>
                  </div>
                  <Badge>{materialsQuery.data?.length ?? 0} 项</Badge>
                </div>
                <div className="commercial-materials__upload">
                  <Field label="素材使用权">
                    <SelectInput
                      value={materialRights}
                      disabled={locked || uploadMaterial.isPending}
                      onChange={(event) =>
                        setMaterialRights(event.target.value as CommercialMaterial['rights_status'])
                      }
                    >
                      <option value="owned">自有素材</option>
                      <option value="licensed">已获授权</option>
                      <option value="public_domain">公版</option>
                      <option value="restricted">仅限内部评估</option>
                    </SelectInput>
                  </Field>
                  <Button
                    type="button"
                    icon={<UploadCloud size={14} />}
                    onClick={() => materialInput.current?.click()}
                    disabled={locked || uploadMaterial.isPending}
                  >
                    {uploadMaterial.isPending ? '正在上传…' : '添加素材'}
                  </Button>
                  <input
                    ref={materialInput}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.pdf,.txt,.md"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) uploadMaterial.mutate(file);
                      event.target.value = '';
                    }}
                  />
                </div>
                {materialsQuery.isError && (
                  <p role="alert" className="form-error">
                    素材列表读取失败：{materialsQuery.error.message}
                  </p>
                )}
                {uploadMaterial.isError && (
                  <p role="alert" className="form-error">
                    素材上传失败：{uploadMaterial.error.message}
                  </p>
                )}
                {materialsQuery.data?.length ? (
                  <div className="commercial-material-list">
                    {materialsQuery.data.map((item) => (
                      <CommercialMaterialRow key={item.id} projectId={project.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="commercial-material-empty">
                    尚无商品素材。提交审核前至少登记一项可用于制作的素材。
                  </div>
                )}
              </section>
              <div className="form-row">
                <Field label="目标受众行动">
                  <TextInput
                    name="call_to_action"
                    required
                    maxLength={500}
                    defaultValue={brief?.call_to_action ?? ''}
                    placeholder="例如：查看产品详情"
                  />
                </Field>
                <Field label="投放渠道">
                  <TextInput
                    name="distribution_channel"
                    required
                    maxLength={200}
                    defaultValue={brief?.distribution_channel ?? ''}
                    placeholder="例如：电商详情页 / 信息流"
                  />
                </Field>
              </div>
              <Field label="目标片长（秒）">
                <TextInput
                  name="target_seconds"
                  type="number"
                  min={5}
                  max={600}
                  required
                  defaultValue={brief?.target_seconds ?? project.episode_seconds ?? 30}
                />
              </Field>
              <label className="rights-checkbox">
                <input
                  name="rights_confirmed"
                  type="checkbox"
                  defaultChecked={brief?.rights_confirmed ?? false}
                />
                <span>
                  我确认拥有或已获授权使用所填产品信息、商标及后续提交的素材，并允许按项目授权范围交由所选模型服务处理。
                </span>
              </label>
            </fieldset>
            {locked && (
              <div className="inline-notice">审核期间锁定当前版本。退回后可修改并生成新修订。</div>
            )}
            {briefQuery.isError && (
              <p className="form-error" role="alert">
                读取失败：{briefQuery.error.message}
              </p>
            )}
            {save.isError && (
              <p className="form-error" role="alert">
                保存失败：{save.error.message}
              </p>
            )}
            {(submitReview.isError || decide.isError) && (
              <p className="form-error" role="alert">
                审核操作失败：{(submitReview.error ?? decide.error)?.message}
              </p>
            )}
            <div className="brief-actions">
              <span>
                {stage?.status === 'accepted'
                  ? '已确认 · 可进入改编大纲'
                  : locked
                    ? '等待人工审核'
                    : '保存后可提交人工审核'}
              </span>
              {locked ? (
                <>
                  <Field label="退回修改意见">
                    <TextInput
                      value={returnReason}
                      onChange={(event) => setReturnReason(event.target.value)}
                      maxLength={1000}
                      placeholder="说明需要修改的产品事实或边界"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={!returnReason.trim() || decide.isPending}
                    onClick={() => decide.mutate('reject')}
                  >
                    退回修改
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate('accept')}
                  >
                    确认商品简报
                  </Button>
                </>
              ) : (
                <>
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? '正在保存…' : '保存简报'}
                  </Button>
                  {stage?.status === 'running' && (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={
                        !brief?.rights_confirmed ||
                        !materialsQuery.data?.length ||
                        submitReview.isPending
                      }
                      title={
                        !brief?.rights_confirmed
                          ? '先确认商品与素材权利'
                          : !materialsQuery.data?.length
                            ? '至少添加一项商品素材'
                            : undefined
                      }
                      onClick={() => submitReview.mutate()}
                    >
                      提交审核
                    </Button>
                  )}
                </>
              )}
            </div>
          </form>
          {notice && (
            <div className="inline-success" role="status">
              <Check size={14} />
              {notice}
              <button onClick={() => setNotice('')} aria-label="关闭">
                ×
              </button>
            </div>
          )}
        </Panel>
        <Panel className="brief-preview">
          <div className="eyebrow">PRODUCTION HANDOFF</div>
          <h3>确认后进入共用生产线</h3>
          <div className="brief-preview__item">
            <span>01</span>
            <b>视频改编大纲</b>
            <small>按渠道、片长、卖点和宣传边界组织结构</small>
          </div>
          <div className="brief-preview__item">
            <span>02</span>
            <b>角色与美术设定</b>
            <small>建立可复用的出镜角色、场景和道具资产</small>
          </div>
          <div className="brief-preview__item">
            <span>03</span>
            <b>剧本、分镜、视频与后期</b>
            <small>各阶段独立审核、调整和重生成</small>
          </div>
          <div className="note-box">
            <ShieldCheck size={15} />
            商品素材现可上传并记录使用权与哈希；素材理解和真实模型生成尚未接入。
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CommercialMaterialRow({
  projectId,
  item,
}: {
  projectId: string;
  item: CommercialMaterial;
}) {
  const kind =
    item.media_kind === 'image' ? '图片' : item.media_kind === 'video' ? '视频' : '说明文件';
  const rights =
    item.rights_status === 'owned'
      ? '自有'
      : item.rights_status === 'licensed'
        ? '已授权'
        : item.rights_status === 'public_domain'
          ? '公版'
          : '仅限内部';
  return (
    <div className="commercial-material-row">
      <span className={`commercial-material-kind commercial-material-kind--${item.media_kind}`}>
        {kind}
      </span>
      <div>
        <a
          href={api.commercialMaterialFileUrl(projectId, item.id)}
          target="_blank"
          rel="noreferrer"
        >
          {item.original_name}
        </a>
        <small>
          {formatBytes(item.size_bytes)} · SHA-256 {item.sha256.slice(0, 12)}…
        </small>
      </div>
      <Badge tone={item.rights_status === 'restricted' ? 'gold' : 'green'}>{rights}</Badge>
    </div>
  );
}

function formatBytes(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Check, ShieldCheck, UploadCloud } from 'lucide-react';
import type { CommercialBriefSaveInput, CommercialMaterial, Project } from '../../lib/types';
import { api } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../ui/Field';
import { PageHeading, Panel } from '../ui/Panel';
