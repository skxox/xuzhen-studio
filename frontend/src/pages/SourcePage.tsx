import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ChevronRight, FileText, FolderInput, LockKeyhole, Plus, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import type { Project } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';

export function SourcePage({ project }: { project?: Project }) {
  const [entry, setEntry] = useState<'source' | 'brief'>(project?.creation_mode === 'original' ? 'brief' : 'source');
  const [toast, setToast] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const chapters = useQuery({ queryKey: ['chapters', project?.id], queryFn: () => api.chapters(project!.id), enabled: Boolean(project?.id) });
  const upload = useMutation({ mutationFn: (file: File) => api.uploadChapters(project!.id, file), onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ['chapters', project?.id] }); setToast(`已解析 ${result.chapters.length} 个章节。导入内容仍待你确认章节顺序和权利状态。`); } });
  const original = project?.creation_mode === 'original';
  useEffect(() => { if (project) setEntry(project.creation_mode === 'original' ? 'brief' : 'source'); }, [project?.id, project?.creation_mode]);
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
      <Panel className="rights-panel"><div className="panel-heading"><div><div className="eyebrow">RIGHTS & DATA USE</div><h3>权利与模型使用范围</h3><p>上传文件前，先确认作品权利。把原文发给云模型还需要单独授权。</p></div><LockKeyhole size={18}/></div>
        <div className="rights-callout"><ShieldCheck size={19}/><span><b>当前项目权利：{project?.rights_status === 'unconfirmed' ? '待确认' : project?.rights_status}</b><small>原文阶段验收前必须记录权利状态；权利待核实的作品不得进入正式发布交付。</small></span></div>
        <div className="rights-list"><div><span>原文进入模型服务</span><Badge tone="gold">默认不授权</Badge></div><div><span>按服务逐个选择文本 / 图片 / 视频</span><Badge>需单独设置</Badge></div><div><span>生成任务保存授权和服务快照</span><Badge>后端待接入</Badge></div></div>
        <Button onClick={() => setToast('权利状态可在创建项目时记录；项目编辑 API 尚待加入。')}>查看项目权利设置 <ChevronRight size={14}/></Button>
      </Panel>
      <Panel className="chapter-panel"><div className="panel-heading"><div><div className="eyebrow">CHAPTER MAP</div><h3>章节结构 <span className="heading-muted">{chapters.data?.length ?? 0} 章</span></h3><p>检查章节顺序、重复内容与分批导入结果。</p></div><button className="plain-icon" aria-label="添加章节" onClick={() => input.current?.click()}><Plus size={17}/></button></div>
        {chapters.isLoading ? <div className="chapter-empty">正在读取章节…</div> : chapters.data?.length ? <div className="chapter-list">{chapters.data.map((chapter) => <div className="chapter-row" key={chapter.id}><span className="chapter-index">{String(chapter.ordinal).padStart(2, '0')}</span><FileText size={16}/><div><b>{chapter.title}</b><small>{chapter.body.length.toLocaleString()} 字 · v{chapter.version} · {chapter.source_name || '粘贴导入'}</small></div><Badge tone="gold">待确认</Badge><button className="text-link">查看</button></div>)}</div> : <div className="chapter-empty"><span><BookOpen size={19}/></span><b>还没有导入章节</b><small>导入作品后，章节解析结果会出现在这里。</small></div>}
        {toast && <div className="inline-success" role="status"><Check size={14}/>{toast}<button onClick={() => setToast('')} aria-label="关闭">×</button></div>}
      </Panel>
      <Panel className="source-analysis-panel"><div className="panel-heading"><div><div className="eyebrow">ANALYSIS QUEUE</div><h3>AI 原文分析</h3><p>抽取结果先形成带出处候选，不会直接进入已确认设定。</p></div><Badge tone="neutral">等待原文确认</Badge></div>
        <div className="analysis-flow"><AnalysisStep number="01" title="章节结构与段落索引" detail="识别章 / 节标题，建立可回跳原文位置"/><AnalysisStep number="02" title="人物、关系与状态" detail="姓名与别名归并；区分原文事实和模型推断"/><AnalysisStep number="03" title="事件、对白与伏笔" detail="提取时间线、信息揭露顺序和场景道具"/><AnalysisStep number="04" title="确认分析候选" detail="逐条审阅出处后，才允许生成改编大纲"/></div>
        <Button variant="primary" disabled={!project || !chapters.data?.length} icon={<Sparkles size={15}/>} onClick={() => setToast('文本 Provider Adapter 尚未接入，因此不会发起真实模型调用。')}>分析原文 <ChevronRight size={14}/></Button>
      </Panel>
    </div> : <BriefWorkspace onSave={() => setToast('创意简报只在本地界面状态保存；原创章节 API 尚待开发。')}/ >}
  </div>;
}

function AnalysisStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return <div className="analysis-step"><span>{number}</span><div><b>{title}</b><small>{detail}</small></div></div>;
}

function BriefWorkspace({ onSave }: { onSave: () => void }) {
  return <div className="brief-grid"><Panel className="brief-form"><div className="panel-heading"><div><div className="eyebrow">CREATIVE BRIEF · DRAFT 01</div><h3>把创作边界讲清楚</h3><p>简报经作者确认后，AI 才能生成故事圣经和章节大纲。</p></div><Badge tone="gold">未确认</Badge></div>
    <div className="brief-form__fields"><Field label="一句话故事 premise"><TextInput defaultValue="一名失去听力的城市测绘师，发现一栋即将拆除的旧楼里藏着全城的秘密。" /></Field><div className="form-row"><Field label="类型与子类型"><TextInput defaultValue="都市悬疑 · 温情"/></Field><Field label="目标读者"><TextInput defaultValue="18–35 岁，偏好现实题材"/></Field></div><div className="form-row"><Field label="叙事视角"><TextInput defaultValue="第三人称限知 · 主角视角"/></Field><Field label="规划规模"><TextInput defaultValue="12 集短篇小说 · 每章约 2500 字"/></Field></div><Field label="风格基线"><TextArea rows={3} defaultValue="克制、细节写实。悬疑依靠人物选择和空间线索推进，不使用超自然解释。"/></Field><Field label="不可写内容 / 约束"><TextArea rows={2} placeholder="暴力尺度、禁用设定、必须保留的现实边界"/></Field><label className="rights-checkbox"><input type="checkbox"/><span>我确认拥有本原创设定与正文的创作权利，并可按项目授权给所选模型服务处理。</span></label>
      <div className="brief-actions"><span>草稿 · 自动保存至当前浏览器</span><Button onClick={onSave}>保存简报</Button><Button variant="primary" icon={<Sparkles size={14}/>}>生成故事圣经候选</Button></div>
    </div></Panel><Panel className="brief-preview"><div className="eyebrow">AI WILL DEVELOP</div><h3>下一步会发生什么</h3><div className="brief-preview__item"><span>01</span><b>故事核心与冲突引擎</b><small>角色目标、阻碍、代价与因果钩子</small></div><div className="brief-preview__item"><span>02</span><b>世界规则与人物圣经</b><small>故事规则、关系弧、人物行为边界</small></div><div className="brief-preview__item"><span>03</span><b>分卷 / 分集 / 章节大纲</b><small>章节卡有目标、冲突、转折与钩子</small></div><div className="note-box"><ShieldCheck size={15}/>所有内容先作为候选；逐项接受后才会进入章节生成上下文。</div></Panel>
  </div>;
}
