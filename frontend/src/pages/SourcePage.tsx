import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ChevronRight, FileText, FolderInput, LockKeyhole, Plus, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import type { Chapter, CommercialBriefSaveInput, CommercialMaterial, CreativeBriefSaveInput, Project } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { Dialog } from '../components/ui/Dialog';

export function SourcePage({ project }: { project?: Project }) {
  const [entry, setEntry] = useState<'source' | 'brief'>(project?.creation_mode === 'original' ? 'brief' : 'source');
  const [toast, setToast] = useState('');
  const [rightsDraft, setRightsDraft] = useState<Project['rights_status']>(project?.rights_status ?? 'unconfirmed');
  const [selectedChapter, setSelectedChapter] = useState<Chapter>();
  const [returnReason, setReturnReason] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const chapters = useQuery({ queryKey: ['chapters', project?.id], queryFn: () => api.chapters(project!.id), enabled: Boolean(project?.id) });
  const stages = useQuery({ queryKey: ['stages', project?.id], queryFn: () => api.stages(project!.id), enabled: Boolean(project?.id) });
  const sourceStage = stages.data?.find((item) => item.stage_key === 'source');
  const upload = useMutation({ mutationFn: (file: File) => api.uploadChapters(project!.id, file), onSuccess: async (result) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['chapters', project?.id] }), queryClient.invalidateQueries({ queryKey: ['stages', project?.id] })]); setToast(`已解析 ${result.chapters.length} 个章节。请抽查原文并确认权利状态后验收。`); } });
  const saveRights = useMutation({ mutationFn: () => api.updateProjectRights(project!.id, rightsDraft), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['projects'] }); setToast('项目权利状态已保存。'); } });
  const decideSource = useMutation({ mutationFn: (action: 'accept' | 'reject') => api.decideStage(project!.id, 'source', action, action === 'reject' ? returnReason.trim() : undefined), onSuccess: async (result) => { setReturnReason(''); await queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }); setToast(result.status === 'accepted' ? '原文来源已验收；视频改编大纲阶段已解锁。' : '原文已退回；重新导入修订内容后可再次审阅。'); } });
  const original = project?.creation_mode === 'original';
  if (project?.creation_mode === 'commercial') return <CommercialBriefWorkspace project={project} />;
  return <div className="source-page">
    <PageHeading eyebrow={original ? 'ORIGINAL STORY' : 'SOURCE MANUSCRIPT'} title={original ? '从一句想法，写出一部小说。' : '先读懂原文，再开始改编。'} description={original ? '创意简报、故事圣经、章节计划与正文分批创作。每个版本可审阅，锁定后再交接视频制作。' : '导入已有作品，确认章节结构与权利，再建立带原文出处的改编依据。'} actions={<Badge tone={project?.rights_status === 'unconfirmed' ? 'gold' : 'green'} dot>{project?.rights_status === 'unconfirmed' ? '权利状态待确认' : '权利信息已记录'}</Badge>} />
    <div className="source-tabs"><button className={entry === 'source' ? 'is-active' : ''} onClick={() => setEntry('source')}><FolderInput size={15}/>已有小说改编</button><button className={entry === 'brief' ? 'is-active' : ''} onClick={() => setEntry('brief')}><Sparkles size={15}/>从创意原创</button></div>
    {!project && <div className="inline-notice"><BookOpen size={17}/><span>当前没有连接的服务端项目。创建项目后，章节导入与创作简报会保存到 API。</span></div>}
    {entry === 'source' ? <div className="source-grid">
      <Panel className="source-import-panel"><div className="panel-heading"><div><div className="eyebrow">01 · IMPORT</div><h3>导入作品原文</h3><p>当前后端支持 UTF-8 编码的 TXT / Markdown。原文会保存在本地 API 数据库。</p></div><Badge tone="blue">TXT · MD</Badge></div>
        <button className="drop-zone" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) upload.mutate(file); }}>
          <span className="drop-zone__icon"><UploadCloud size={22}/></span><b>拖放小说文件到这里</b><small>或从电脑中选择 · 单个文件不超过 40 MB</small><span className="drop-zone__cta">选择文件 <ChevronRight size={14}/></span>
        </button><input ref={input} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ''; }} />
        {upload.isPending && <div className="upload-progress"><span/><small>正在上传并解析章节…</small></div>}
        {upload.isError && <p role="alert" className="form-error">导入失败：{upload.error.message}</p>}
        <div className="import-rules"><div><Check size={14}/>自动识别章节标题</div><div><Check size={14}/>记录文件名与内容哈希</div><div><Check size={14}/>进入原文审阅门禁</div></div>
      </Panel>
      <Panel className="rights-panel"><div className="panel-heading"><div><div className="eyebrow">RIGHTS & DATA USE</div><h3>权利与模型使用范围</h3><p>记录原作使用依据；云端模型处理仍需单独授权。</p></div><LockKeyhole size={18}/></div>
        <div className="rights-callout"><ShieldCheck size={19}/><span><b>当前项目权利：{rightsLabel(project?.rights_status)}</b><small>原文阶段验收前必须记录权利状态；限制使用的作品只能在授权范围内推进。</small></span></div>
        <Field label="原作权利状态"><SelectInput value={rightsDraft} disabled={sourceStage?.status === 'needs_review'} onChange={(event) => setRightsDraft(event.target.value as Project['rights_status'])}><option value="unconfirmed">待确认</option><option value="owned">自有版权</option><option value="licensed">已获授权</option><option value="public_domain">公版作品</option><option value="restricted">仅限内部评估</option></SelectInput></Field>
        <Button disabled={!project || saveRights.isPending || rightsDraft === project?.rights_status || sourceStage?.status === 'needs_review'} onClick={() => saveRights.mutate()}>{saveRights.isPending ? '正在保存…' : '保存权利状态'}</Button>
        {saveRights.isError && <p className="form-error" role="alert">权利状态保存失败：{saveRights.error.message}</p>}
        <div className="rights-list"><div><span>原文进入模型服务</span><Badge tone="gold">默认不授权</Badge></div><div><span>按服务逐个选择文本 / 图片 / 视频</span><Badge>需单独设置</Badge></div><div><span>生成任务保存授权和服务快照</span><Badge>后端待接入</Badge></div></div>
      </Panel>
      <Panel className="chapter-panel"><div className="panel-heading"><div><div className="eyebrow">CHAPTER MAP</div><h3>章节结构 <span className="heading-muted">{chapters.data?.length ?? 0} 章</span></h3><p>检查章节顺序、重复内容与分批导入结果。</p></div><button className="plain-icon" aria-label="添加章节" onClick={() => input.current?.click()}><Plus size={17}/></button></div>
        {chapters.isLoading ? <div className="chapter-empty">正在读取章节…</div> : chapters.data?.length ? <div className="chapter-list">{chapters.data.map((chapter) => <div className="chapter-row" key={chapter.id}><span className="chapter-index">{String(chapter.ordinal).padStart(2, '0')}</span><FileText size={16}/><div><b>{chapter.title}</b><small>{chapter.body.length.toLocaleString()} 字 · v{chapter.version} · {chapter.source_name || '粘贴导入'}</small></div><Badge tone={sourceStage?.status === 'accepted' ? 'green' : 'gold'}>{sourceStage?.status === 'accepted' ? '已验收' : '待审阅'}</Badge><button className="text-link" onClick={() => setSelectedChapter(chapter)}>查看</button></div>)}</div> : <div className="chapter-empty"><span><BookOpen size={19}/></span><b>还没有导入章节</b><small>导入作品后，章节解析结果会出现在这里。</small></div>}
        {sourceStage?.status === 'needs_review' && <div className="source-review-box"><div><b>原文来源等待审核</b><small>逐章抽查导入结果，确认权利状态已记录，再验收并解锁改编大纲。</small></div><Field label="退回原因"><TextInput value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={1000} placeholder="例如：章节缺失，需重新导入" /></Field><div className="brief-actions"><Button variant="danger" disabled={!returnReason.trim() || decideSource.isPending} onClick={() => decideSource.mutate('reject')}>退回修订</Button><Button variant="primary" disabled={!chapters.data?.length || project?.rights_status === 'unconfirmed' || decideSource.isPending} title={project?.rights_status === 'unconfirmed' ? '请先保存原作权利状态' : undefined} onClick={() => decideSource.mutate('accept')}>验收原文并解锁下一阶段</Button></div>{decideSource.isError && <p className="form-error" role="alert">审核操作失败：{decideSource.error.message}</p>}</div>}
        {toast && <div className="inline-success" role="status"><Check size={14}/>{toast}<button onClick={() => setToast('')} aria-label="关闭">×</button></div>}
      </Panel>
      <Panel className="source-analysis-panel"><div className="panel-heading"><div><div className="eyebrow">ANALYSIS QUEUE</div><h3>AI 原文分析</h3><p>抽取结果先形成带出处候选，不会直接进入已确认设定。</p></div><Badge tone="neutral">等待原文确认</Badge></div>
        <div className="analysis-flow"><AnalysisStep number="01" title="章节结构与段落索引" detail="识别章 / 节标题，建立可回跳原文位置"/><AnalysisStep number="02" title="人物、关系与状态" detail="姓名与别名归并；区分原文事实和模型推断"/><AnalysisStep number="03" title="事件、对白与伏笔" detail="提取时间线、信息揭露顺序和场景道具"/><AnalysisStep number="04" title="确认分析候选" detail="逐条审阅出处后，才允许生成改编大纲"/></div>
        <Button variant="primary" disabled={!project || !chapters.data?.length} icon={<Sparkles size={15}/>} onClick={() => setToast('文本 Provider Adapter 尚未接入，因此不会发起真实模型调用。')}>分析原文 <ChevronRight size={14}/></Button>
      </Panel>
    </div> : <BriefWorkspace project={project} onSave={setToast} onGenerate={() => setToast('故事圣经生成尚未启用：请先配置文本服务，接入真实 Provider 后才会创建生成任务。')}/ >}
    <Dialog open={Boolean(selectedChapter)} onClose={() => setSelectedChapter(undefined)} title={selectedChapter?.title ?? '章节原文'} description={selectedChapter ? `第 ${selectedChapter.ordinal} 章 · v${selectedChapter.version} · ${selectedChapter.body.length.toLocaleString()} 字 · SHA-256 ${selectedChapter.content_hash.slice(0, 16)}…` : undefined}>
      {selectedChapter && <pre className="chapter-preview">{selectedChapter.body}</pre>}
    </Dialog>
  </div>;
}

function rightsLabel(status?: Project['rights_status']): string {
  return ({ unconfirmed: '待确认', owned: '自有版权', licensed: '已获授权', public_domain: '公版作品', restricted: '仅限内部评估' } as const)[status ?? 'unconfirmed'];
}

function CommercialBriefWorkspace({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [returnReason, setReturnReason] = useState('');
  const [notice, setNotice] = useState('');
  const [materialRights, setMaterialRights] = useState<CommercialMaterial['rights_status']>('owned');
  const materialInput = useRef<HTMLInputElement>(null);
  const briefQuery = useQuery({ queryKey: ['commercial-brief', project.id], queryFn: () => api.commercialBrief(project.id), retry: false });
  const materialsQuery = useQuery({ queryKey: ['commercial-materials', project.id], queryFn: () => api.commercialMaterials(project.id), retry: false });
  const stagesQuery = useQuery({ queryKey: ['stages', project.id], queryFn: () => api.stages(project.id), retry: false });
  const stage = stagesQuery.data?.find((item) => item.stage_key === 'commercialBrief');
  const save = useMutation({ mutationFn: (body: CommercialBriefSaveInput) => api.saveCommercialBrief(project.id, body), onSuccess: async (brief) => {
    queryClient.setQueryData(['commercial-brief', project.id], brief);
    await queryClient.invalidateQueries({ queryKey: ['stages', project.id] });
    setNotice(`商品简报已保存 · 修订 v${String(brief.revision).padStart(2, '0')}。`);
  } });
  const uploadMaterial = useMutation({ mutationFn: (file: File) => api.uploadCommercialMaterial(project.id, file, materialRights), onSuccess: async (material) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['commercial-materials', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }),
      queryClient.invalidateQueries({ queryKey: ['stages', project.id] }),
    ]);
    setNotice(`已登记素材「${material.original_name}」；授权状态和 SHA-256 已保存。`);
  } });
  const submitReview = useMutation({ mutationFn: () => api.submitStageReview(project.id, 'commercialBrief'), onSuccess: async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }), queryClient.invalidateQueries({ queryKey: ['stages', project.id] })]);
    setNotice('商品简报已提交审核；当前版本已锁定。');
  } });
  const decide = useMutation({ mutationFn: (action: 'accept' | 'reject') => api.decideStage(project.id, 'commercialBrief', action, action === 'reject' ? returnReason.trim() : undefined), onSuccess: async (result) => {
    setReturnReason('');
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['commercial-brief', project.id] }), queryClient.invalidateQueries({ queryKey: ['stages', project.id] })]);
    setNotice(result.status === 'accepted' ? '商品事实已确认；改编大纲阶段已解锁。' : '商品简报已退回，请按审核意见修订。');
  } });
  const brief = briefQuery.data;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = (key: string) => String(form.get(key) ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    save.mutate({
      product_name: String(form.get('product_name') ?? ''), category: String(form.get('category') ?? ''),
      product_facts: String(form.get('product_facts') ?? ''), target_audience: String(form.get('target_audience') ?? ''),
      selling_points: lines('selling_points'), approved_claims: lines('approved_claims'),
      prohibited_claims: lines('prohibited_claims'), call_to_action: String(form.get('call_to_action') ?? ''),
      distribution_channel: String(form.get('distribution_channel') ?? ''), target_seconds: Number(form.get('target_seconds')),
      rights_confirmed: form.get('rights_confirmed') === 'on',
    });
  };
  if (briefQuery.isLoading) return <div className="chapter-empty">正在读取商品简报…</div>;
  const locked = stage?.status === 'needs_review';
  return <div className="source-page">
    <PageHeading eyebrow="COMMERCIAL PRODUCTION" title="先确认产品事实，再规划广告短片。" description="明确受众、卖点、可用证据和禁用承诺；审核通过后才解锁大纲与共用视频制作阶段。" actions={<Badge tone={stage?.status === 'accepted' ? 'green' : 'gold'} dot>{stage?.status === 'accepted' ? '商品简报已确认' : stage?.status === 'needs_review' ? '等待人工审核' : '产品信息待确认'}</Badge>} />
    <div className="commercial-brief-layout">
      <Panel className="brief-form"><div className="panel-heading"><div><div className="eyebrow">PRODUCT FACTS · {brief ? `REVISION ${String(brief.revision).padStart(2, '0')}` : 'DRAFT'}</div><h3>商品与素材简报</h3><p>结构化记录将成为后续脚本生成的约束和审阅依据。</p></div><Badge tone={brief ? 'blue' : 'neutral'}>{brief?.status ?? '未保存'}</Badge></div>
        <form className="brief-form__fields" onSubmit={submit}>
          <fieldset className="commercial-brief-fields" disabled={locked}>
          <div className="form-row"><Field label="商品名称"><TextInput name="product_name" required maxLength={200} defaultValue={brief?.product_name ?? ''} placeholder="例如：轻量通勤保温杯" /></Field><Field label="品类"><TextInput name="category" required maxLength={200} defaultValue={brief?.category ?? ''} placeholder="例如：户外饮具" /></Field></div>
          <Field label="产品事实与可验证规格" hint="只写有依据的材料、容量、检测信息等；不要把推断写成事实。"><TextArea name="product_facts" required rows={3} maxLength={5000} defaultValue={brief?.product_facts ?? ''} placeholder="材质、尺寸、功能、适用条件、证据来源……" /></Field>
          <Field label="目标受众"><TextArea name="target_audience" required rows={2} maxLength={2000} defaultValue={brief?.target_audience ?? ''} placeholder="受众场景、需求和购买顾虑" /></Field>
          <Field label="核心卖点" hint="每行一项；后续脚本按已审核的卖点取舍。"><TextArea name="selling_points" required rows={3} defaultValue={brief?.selling_points.join('\n') ?? ''} placeholder="轻便，适合日常通勤\n杯盖可拆洗" /></Field>
          <div className="form-row"><Field label="允许使用的宣传语 / 证据"><TextArea name="approved_claims" rows={3} defaultValue={brief?.approved_claims.join('\n') ?? ''} placeholder="每行一项；附上可支持该表述的证据" /></Field><Field label="禁止或高风险宣传语"><TextArea name="prohibited_claims" rows={3} defaultValue={brief?.prohibited_claims.join('\n') ?? ''} placeholder="每行一项；包括不能保证的效果与绝对化用语" /></Field></div>
          <section className="commercial-materials"><div className="commercial-materials__heading"><div><b>商品素材</b><small>图片、视频或说明文件；每项单独记录使用权状态与文件校验哈希。</small></div><Badge>{materialsQuery.data?.length ?? 0} 项</Badge></div>
            <div className="commercial-materials__upload"><Field label="素材使用权"><SelectInput value={materialRights} disabled={locked || uploadMaterial.isPending} onChange={(event) => setMaterialRights(event.target.value as CommercialMaterial['rights_status'])}><option value="owned">自有素材</option><option value="licensed">已获授权</option><option value="public_domain">公版</option><option value="restricted">仅限内部评估</option></SelectInput></Field><Button type="button" icon={<UploadCloud size={14}/>} onClick={() => materialInput.current?.click()} disabled={locked || uploadMaterial.isPending}>{uploadMaterial.isPending ? '正在上传…' : '添加素材'}</Button><input ref={materialInput} type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.webm,.pdf,.txt,.md" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadMaterial.mutate(file); event.target.value = ''; }} /></div>
            {materialsQuery.isError && <p role="alert" className="form-error">素材列表读取失败：{materialsQuery.error.message}</p>}
            {uploadMaterial.isError && <p role="alert" className="form-error">素材上传失败：{uploadMaterial.error.message}</p>}
            {materialsQuery.data?.length ? <div className="commercial-material-list">{materialsQuery.data.map((item) => <CommercialMaterialRow key={item.id} projectId={project.id} item={item} />)}</div> : <div className="commercial-material-empty">尚无商品素材。提交审核前至少登记一项可用于制作的素材。</div>}
          </section>
          <div className="form-row"><Field label="目标受众行动"><TextInput name="call_to_action" required maxLength={500} defaultValue={brief?.call_to_action ?? ''} placeholder="例如：查看产品详情" /></Field><Field label="投放渠道"><TextInput name="distribution_channel" required maxLength={200} defaultValue={brief?.distribution_channel ?? ''} placeholder="例如：电商详情页 / 信息流" /></Field></div>
          <Field label="目标片长（秒）"><TextInput name="target_seconds" type="number" min={5} max={600} required defaultValue={brief?.target_seconds ?? project.episode_seconds ?? 30} /></Field>
          <label className="rights-checkbox"><input name="rights_confirmed" type="checkbox" defaultChecked={brief?.rights_confirmed ?? false} /><span>我确认拥有或已获授权使用所填产品信息、商标及后续提交的素材，并允许按项目授权范围交由所选模型服务处理。</span></label>
          </fieldset>
          {locked && <div className="inline-notice">审核期间锁定当前版本。退回后可修改并生成新修订。</div>}
          {briefQuery.isError && <p className="form-error" role="alert">读取失败：{briefQuery.error.message}</p>}
          {save.isError && <p className="form-error" role="alert">保存失败：{save.error.message}</p>}
          {(submitReview.isError || decide.isError) && <p className="form-error" role="alert">审核操作失败：{(submitReview.error ?? decide.error)?.message}</p>}
          <div className="brief-actions"><span>{stage?.status === 'accepted' ? '已确认 · 可进入改编大纲' : locked ? '等待人工审核' : '保存后可提交人工审核'}</span>
            {locked ? <><Field label="退回修改意见"><TextInput value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={1000} placeholder="说明需要修改的产品事实或边界" /></Field><Button type="button" variant="danger" disabled={!returnReason.trim() || decide.isPending} onClick={() => decide.mutate('reject')}>退回修改</Button><Button type="button" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate('accept')}>确认商品简报</Button></> : <><Button type="submit" disabled={save.isPending}>{save.isPending ? '正在保存…' : '保存简报'}</Button>{stage?.status === 'running' && <Button type="button" variant="primary" disabled={!brief?.rights_confirmed || !materialsQuery.data?.length || submitReview.isPending} title={!brief?.rights_confirmed ? '先确认商品与素材权利' : !materialsQuery.data?.length ? '至少添加一项商品素材' : undefined} onClick={() => submitReview.mutate()}>提交审核</Button>}</>}
          </div>
        </form>
        {notice && <div className="inline-success" role="status"><Check size={14}/>{notice}<button onClick={() => setNotice('')} aria-label="关闭">×</button></div>}
      </Panel>
      <Panel className="brief-preview"><div className="eyebrow">PRODUCTION HANDOFF</div><h3>确认后进入共用生产线</h3><div className="brief-preview__item"><span>01</span><b>视频改编大纲</b><small>按渠道、片长、卖点和宣传边界组织结构</small></div><div className="brief-preview__item"><span>02</span><b>角色与美术设定</b><small>建立可复用的出镜角色、场景和道具资产</small></div><div className="brief-preview__item"><span>03</span><b>剧本、分镜、视频与后期</b><small>各阶段独立审核、调整和重生成</small></div><div className="note-box"><ShieldCheck size={15}/>商品素材现可上传并记录使用权与哈希；素材理解和真实模型生成尚未接入。</div></Panel>
    </div>
  </div>;
}

function CommercialMaterialRow({ projectId, item }: { projectId: string; item: CommercialMaterial }) {
  const kind = item.media_kind === 'image' ? '图片' : item.media_kind === 'video' ? '视频' : '说明文件';
  const rights = item.rights_status === 'owned' ? '自有' : item.rights_status === 'licensed' ? '已授权' : item.rights_status === 'public_domain' ? '公版' : '仅限内部';
  return <div className="commercial-material-row"><span className={`commercial-material-kind commercial-material-kind--${item.media_kind}`}>{kind}</span><div><a href={api.commercialMaterialFileUrl(projectId, item.id)} target="_blank" rel="noreferrer">{item.original_name}</a><small>{formatBytes(item.size_bytes)} · SHA-256 {item.sha256.slice(0, 12)}…</small></div><Badge tone={item.rights_status === 'restricted' ? 'gold' : 'green'}>{rights}</Badge></div>;
}

function formatBytes(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AnalysisStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <div className="analysis-step"><span>{number}</span><div><b>{title}</b><small>{detail}</small></div></div>;
}

function BriefWorkspace({ project, onSave, onGenerate }: { project?: Project; onSave: (message: string) => void; onGenerate: () => void }) {
  const queryClient = useQueryClient();
  const [returnReason, setReturnReason] = useState('');
  const briefQuery = useQuery({ queryKey: ['creative-brief', project?.id], queryFn: () => api.creativeBrief(project!.id), enabled: Boolean(project?.id && project.creation_mode === 'original'), retry: false });
  const stagesQuery = useQuery({ queryKey: ['stages', project?.id], queryFn: () => api.stages(project!.id), enabled: Boolean(project?.id && project.creation_mode === 'original'), retry: false });
  const stage = stagesQuery.data?.find((item) => item.stage_key === 'creativeBrief');
  const saveMutation = useMutation({ mutationFn: (input: CreativeBriefSaveInput) => api.saveCreativeBrief(project!.id, input), onSuccess: async (brief) => {
    queryClient.setQueryData(['creative-brief', project?.id], brief);
    await queryClient.invalidateQueries({ queryKey: ['stages', project?.id] });
    onSave(`创意简报已保存到项目 · 修订 v${String(brief.revision).padStart(2, '0')}。`);
  } });
  const submitReview = useMutation({ mutationFn: () => api.submitStageReview(project!.id, 'creativeBrief'), onSuccess: async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['creative-brief', project?.id] }), queryClient.invalidateQueries({ queryKey: ['stages', project?.id] })]);
    onSave('创意简报已提交审阅；审阅期间内容已锁定。');
  } });
  const decideReview = useMutation({ mutationFn: (action: 'accept' | 'reject') => api.decideStage(project!.id, 'creativeBrief', action, action === 'reject' ? returnReason.trim() : undefined), onSuccess: async (result) => {
    setReturnReason('');
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['creative-brief', project?.id] }), queryClient.invalidateQueries({ queryKey: ['stages', project?.id] })]);
    onSave(result.status === 'accepted' ? '创意简报已确认；可进入故事圣经阶段。' : '创意简报已退回修改，请按意见修订后重新提交。');
  } });
  if (briefQuery.isLoading && project?.id) return <div className="chapter-empty">正在读取项目创意简报…</div>;
  const brief = briefQuery.data;
  const canSave = Boolean(project?.id && project.creation_mode === 'original');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project?.id) return;
    const form = new FormData(event.currentTarget);
    saveMutation.mutate({
      premise: String(form.get('premise') ?? ''), genre: String(form.get('genre') ?? ''),
      target_readers: String(form.get('target_readers') ?? ''), narrative_pov: String(form.get('narrative_pov') ?? ''),
      planned_scope: String(form.get('planned_scope') ?? ''), style_baseline: String(form.get('style_baseline') ?? ''),
      constraints: String(form.get('constraints') ?? ''), rights_confirmed: form.get('rights_confirmed') === 'on',
    });
  };
  return <div className="brief-grid"><Panel className="brief-form"><div className="panel-heading"><div><div className="eyebrow">CREATIVE BRIEF · {brief ? `REVISION ${String(brief.revision).padStart(2, '0')}` : 'DRAFT'}</div><h3>把创作边界讲清楚</h3><p>简报保存到当前项目后，才能作为原创故事生成任务的输入。</p></div><Badge tone={brief ? 'blue' : 'gold'}>{brief ? '已保存草稿' : '未保存'}</Badge></div>
    <form className="brief-form__fields" onSubmit={submit}>{project && project.creation_mode !== 'original' && <div className="inline-notice"><BookOpen size={17}/><span>当前项目创建于“已有小说改编”入口。创意简报只保存到原创项目，请切换或新建原创项目。</span></div>}<fieldset className="brief-edit-fields" disabled={stage?.status === 'needs_review'}><Field label="一句话故事 premise"><TextInput name="premise" required maxLength={3000} defaultValue={brief?.premise ?? '南汀岛旧气象站封存前，档案修复员林澄在一场旧风暴的记录里发现被挪走的十一分钟。'} /></Field><div className="form-row"><Field label="类型与子类型"><TextInput name="genre" required maxLength={200} defaultValue={brief?.genre ?? '海岛悬疑 · 现实群像'}/></Field><Field label="目标读者"><TextInput name="target_readers" required maxLength={1000} defaultValue={brief?.target_readers ?? '喜欢地方故事、档案谜题与克制关系线的成年读者'}/></Field></div><div className="form-row"><Field label="叙事视角"><TextInput name="narrative_pov" required maxLength={200} defaultValue={brief?.narrative_pov ?? '第三人称限知 · 林澄视角'}/></Field><Field label="规划规模"><TextInput name="planned_scope" required maxLength={300} defaultValue={brief?.planned_scope ?? '8 集短篇小说 · 每章约 2200 字'}/></Field></div><Field label="风格基线"><TextArea name="style_baseline" rows={3} required maxLength={3000} defaultValue={brief?.style_baseline ?? '潮湿、安静、细节准确。谜题由仪器记录、档案版本和人物选择推进；不使用超自然解释。海岛生活有具体劳作与地方气候，不把居民写成背景奇观。'}/></Field><Field label="不可写内容 / 约束"><TextArea name="constraints" rows={2} maxLength={3000} defaultValue={brief?.constraints ?? ''} placeholder="暴力尺度、禁用设定、必须保留的现实边界"/></Field><label className="rights-checkbox"><input name="rights_confirmed" type="checkbox" defaultChecked={brief?.rights_confirmed ?? false}/><span>我确认拥有本原创设定与正文的创作权利，并可按项目授权给所选模型服务处理。</span></label></fieldset>
      {briefQuery.isError && <p role="alert" className="form-error">读取简报失败：{briefQuery.error.message}</p>}{stagesQuery.isError && <p role="alert" className="form-error">读取阶段状态失败：{stagesQuery.error.message}</p>}{saveMutation.isError && <p role="alert" className="form-error">保存失败：{saveMutation.error.message}</p>}
      {submitReview.isError && <p role="alert" className="form-error">提交审阅失败：{submitReview.error.message}</p>}{decideReview.isError && <p role="alert" className="form-error">审阅操作失败：{decideReview.error.message}</p>}
      <div className="brief-actions"><span>{stage?.status === 'accepted' ? '已确认 · 可开始故事圣经' : stage?.status === 'needs_review' ? '等待作者确认' : canSave ? '草稿 · 保存后可提交审阅' : '创建原创项目后可保存'}</span>
        {stage?.status === 'needs_review' ? <><Button type="button" variant="danger" disabled={!returnReason.trim() || decideReview.isPending} onClick={() => decideReview.mutate('reject')}>退回修改</Button><Button type="button" variant="primary" disabled={decideReview.isPending} onClick={() => decideReview.mutate('accept')}>确认简报</Button></> : <Button type="submit" disabled={!canSave || saveMutation.isPending}>{saveMutation.isPending ? '正在保存…' : '保存简报'}</Button>}
        {stage?.status === 'needs_review' && <Field label="退回修改意见"><TextInput value={returnReason} onChange={(event) => setReturnReason(event.target.value)} maxLength={1000} placeholder="说明需要修改的内容"/></Field>}
        {stage?.status === 'running' && <Button type="button" onClick={() => submitReview.mutate()} disabled={!brief?.rights_confirmed || submitReview.isPending} title={!brief?.rights_confirmed ? '请先确认权利声明并保存' : undefined}>{submitReview.isPending ? '正在提交…' : '提交作者确认'}</Button>}
        <Button type="button" variant="primary" icon={<Sparkles size={14}/>} onClick={onGenerate} disabled={stage?.status !== 'accepted'} title={stage?.status !== 'accepted' ? '先保存并确认创意简报' : '文本 Provider 尚未连接'}>生成故事圣经候选</Button>
      </div>
    </form></Panel><Panel className="brief-preview"><div className="eyebrow">AI WILL DEVELOP</div><h3>下一步会发生什么</h3><div className="brief-preview__item"><span>01</span><b>故事核心与冲突引擎</b><small>角色目标、阻碍、代价与因果钩子</small></div><div className="brief-preview__item"><span>02</span><b>世界规则与人物圣经</b><small>故事规则、关系弧、人物行为边界</small></div><div className="brief-preview__item"><span>03</span><b>分卷 / 分集 / 章节大纲</b><small>章节卡有目标、冲突、转折与钩子</small></div><div className="note-box"><ShieldCheck size={15}/>所有内容先作为候选；逐项接受后才会进入章节生成上下文。</div></Panel>
  </div>;
}
