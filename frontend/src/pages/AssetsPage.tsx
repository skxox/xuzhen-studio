import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aperture, ArrowDownToLine, AudioLines, FileImage, Filter, ImagePlus, Plus, Search, SlidersHorizontal, Sparkles, Video } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Field, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { CharacterReference, Project } from '../lib/types';

type Asset = { name: string; type: string; version: string; use: string; tone: string; localDraft?: boolean; id?: string; details?: string };

const initialAssets: Asset[] = [
  { name: '南汀气象站 · 记录室', type: '场景', version: 'v04', use: '本集 4 个镜头', tone: 'scene' },
  { name: '林澄 · 防风外套', type: '角色', version: 'v02', use: '第 1 季 · 21 镜', tone: 'person' },
  { name: '陆闻川 · 电台值守装', type: '角色', version: 'v03', use: '第 1 季 · 8 镜', tone: 'portrait' },
  { name: '短波录音机 · 磁带盒', type: '道具', version: 'v01', use: '第 4 集 · 3 镜', tone: 'prop' },
  { name: '镜头 01 · 关键帧', type: '关键帧', version: 'v03', use: 'Shot 01 · 16:9', tone: 'frame' },
  { name: '旧气象站 · 一层测绘图', type: '场景', version: 'v02', use: '美术圣经', tone: 'blueprint' },
];

export function AssetsPage({ project }: { project?: Project }) {
  const [localAssets, setLocalAssets] = useState(initialAssets);
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState('');
  const queryClient = useQueryClient();
  const referencesQuery = useQuery({ queryKey: ['character-references', project?.id], queryFn: () => api.characterReferences(project!.id), enabled: Boolean(project?.id), retry: false });
  const createReference = useMutation({ mutationFn: (body: { name: string; immutable_features: string; costume_rules: string }) => api.createCharacterReference(project!.id, body), onSuccess: async (item) => {
    await queryClient.invalidateQueries({ queryKey: ['character-references', project?.id] });
    setCreateOpen(false); setToast(`「${item.name}」已保存到项目角色参考草稿 v${String(item.version).padStart(2, '0')}；图片仍未生成。`);
  }, onError: (error) => setToast(`保存失败：${error.message}`) });
  const referenceAssets = (referencesQuery.data ?? []).map(referenceToAsset);
  const assets = [...referenceAssets, ...localAssets];
  const visible = assets.filter((asset) => (filter === '全部' || asset.type === filter) && asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const createCharacterDraft = (form: FormData) => {
    const name = String(form.get('name') ?? '').trim();
    const invariants = String(form.get('invariants') ?? '').trim();
    const costume = String(form.get('costume') ?? '').trim();
    if (!name || !invariants || !costume) return;
    if (project?.id) {
      createReference.mutate({ name, immutable_features: invariants, costume_rules: costume });
      return;
    }
    setLocalAssets((items) => [{ name, type: '角色', version: '本地草稿', use: '角色参考表 · 待审阅', tone: 'person', localDraft: true, details: `${invariants}\n${costume}` }, ...items]);
    setFilter('全部'); setQuery(''); setCreateOpen(false);
    setToast(`已创建「${name}」的本地角色参考草稿；连接项目后可保存到 API。`);
  };

  return <div className="assets-page"><PageHeading eyebrow="ASSET LIBRARY" title="场景、角色与镜头，共用一套素材版本。" description="每个生成任务引用精确的素材版本、用途与权重。角色参考先锁定不可变特征，再准备多视图候选，供人工确认后进入镜头。" actions={<><Button icon={<ArrowDownToLine size={15}/>} onClick={() => setToast('素材导入 API 尚未连接；当前支持查看和编辑本地演示数据。')}>导入素材</Button><Button variant="primary" icon={<Plus size={15}/>} onClick={() => setCreateOpen(true)}>新建角色参考</Button></>} />
    <div className="asset-summary"><div><span className="asset-summary__mark"><Aperture size={17}/></span><b>{project?.name ?? '第一季 · 海岛气象档案'}</b><Badge tone={project ? 'blue' : 'green'}>{project ? `${referencesQuery.data?.length ?? 0} 份角色参考` : '演示素材'}</Badge></div><p>角色参考草稿会与当前项目关联；参考图生成和角色一致性检测需配置图片 Provider。</p><button className="text-link" onClick={() => setToast('美术设定按项目版本管理；在线锁版能力尚未连接。')}>查看美术设定 <Sparkles size={13}/></button></div>
    <div className="asset-controls"><div className="asset-filters">{['全部', '角色', '场景', '道具', '关键帧'].map((item) => <button key={item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}{item === '全部' && <small>{assets.length}</small>}</button>)}</div><div className="asset-search"><Search size={15}/><input aria-label="搜索资产" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产名称"/></div><button className="quiet-action" onClick={() => setToast('引用状态筛选需要资产引用 API；当前列表展示项目演示引用。')}><Filter size={14}/>引用状态</button><button className="plain-icon" aria-label="资产筛选说明" onClick={() => setToast('可用筛选：资产类型与名称；更多状态筛选待接入真实资产数据。')}><SlidersHorizontal size={15}/></button></div>
    {referencesQuery.isError && <div className="inline-notice" role="status">未能读取项目角色参考：{referencesQuery.error.message}</div>}
    {referencesQuery.isLoading && project && <div className="chapter-empty">正在读取项目角色参考…</div>}
    {visible.length ? <div className="asset-grid">{visible.map((asset, index) => <AssetCard key={asset.id ?? `${asset.name}-${index}`} asset={asset} index={index} onAction={(message) => setToast(message)}/>)}</div> : <Panel className="asset-empty"><b>没有匹配的资产</b><span>试试其他关键词或切换资产类型。</span><button className="text-link" onClick={() => { setQuery(''); setFilter('全部'); }}>清除筛选</button></Panel>}
    <Panel className="asset-provenance"><div><FileImage size={16}/><span><b>资产出处与授权记录</b><small>角色与场景的关键事实保留来源；AI 生成资产记录模型、提示词版本和引用素材。</small></span></div><Badge>审计记录已启用</Badge></Panel>
    <CharacterReferenceDialog open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={createCharacterDraft} isSaving={createReference.isPending}/>
    {toast && <div className="toast" role="status"><span className="toast-mark">✓</span>{toast}<button aria-label="关闭提示" onClick={() => setToast('')}>×</button></div>}
  </div>;
}

function CharacterReferenceDialog({ open, onClose, onSubmit, isSaving }: { open: boolean; onClose: () => void; onSubmit: (form: FormData) => void; isSaving: boolean }) {
  return <Dialog open={open} onClose={onClose} title="建立角色参考表" description="先定义角色锚点与服装连续性，再请求图像模型生成候选。新建内容会保存为草稿，不代表已生成参考图。" footer={<><Button onClick={onClose} disabled={isSaving}>取消</Button><Button variant="primary" type="submit" form="character-reference-form" disabled={isSaving}>{isSaving ? '正在保存…' : '保存角色草稿'}</Button></>}>
    <form id="character-reference-form" className="character-reference-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
      <Field label="角色名称" hint="在剧本、素材引用和分镜中使用的统一名称"><TextInput name="name" required maxLength={60} placeholder="例如：林澄" /></Field>
      <Field label="不可变特征" hint="跨镜头必须保持一致：年龄感、脸型、发型、肤色、体态或显著标记"><TextArea name="invariants" rows={3} required maxLength={600} placeholder="例如：三十岁左右，短黑发，左眉尾有浅疤，身形清瘦……" /></Field>
      <Field label="基准服装与状态" hint="说明默认服装、材质、颜色，以及何时允许切换"><TextArea name="costume" rows={2} required maxLength={400} placeholder="例如：深蓝防风外套、灰色针织衫；夜间外景加黄色救生衣。" /></Field>
      <fieldset className="reference-view-set"><legend>参考视图清单</legend><label><input type="checkbox" defaultChecked disabled/> 正面全身</label><label><input type="checkbox" defaultChecked disabled/> 侧面全身</label><label><input type="checkbox" defaultChecked disabled/> 背面全身</label><label><input type="checkbox" defaultChecked disabled/> 面部表情</label><small>视图模板固定用于角色一致性对照；生成服务接入后可配置画幅和模型。</small></fieldset>
      <div className="reference-provider-note"><ImagePlus size={15}/><span><b>图片生成尚未连接</b><small>保存草稿不会调用模型。接入图像 Provider 后才可提交生成任务，并记录模型、提示词和候选版本。</small></span></div>
    </form>
  </Dialog>;
}

function referenceToAsset(reference: CharacterReference): Asset {
  return { id: reference.id, name: reference.name, type: '角色', version: `v${String(reference.version).padStart(2, '0')}`, use: `角色参考表 · ${reference.status === 'draft' ? '草稿待审阅' : reference.status}`, tone: 'person', localDraft: false, details: `不可变特征：${reference.immutable_features}\n服装规则：${reference.costume_rules}\n参考视图：${reference.reference_views.length}/4；图片尚未生成。` };
}

function AssetCard({ asset, index, onAction }: { asset: Asset; index: number; onAction: (message: string) => void }) {
  const Icon = asset.type === '关键帧' ? Video : asset.type === '角色' ? AudioLines : ImagePlus;
  return <Panel className="asset-card"><button className={`asset-visual asset-visual--${asset.tone}`} aria-label={`打开${asset.name}`} onClick={() => onAction(asset.details ?? `「${asset.name}」的详情编辑尚未连接资产服务。`)}><div className="asset-visual__shape"/><span className="asset-visual__index">A{String(index + 1).padStart(2, '0')}</span><span className="asset-version">{asset.version}</span></button><div className="asset-card__body"><div><Badge tone={asset.type === '角色' ? 'violet' : asset.type === '关键帧' ? 'gold' : 'blue'}>{asset.localDraft ? '本地草稿' : asset.type}</Badge><button className="plain-icon" aria-label={`${asset.name}选项`} onClick={() => onAction('资产版本操作需要资产服务；当前为只读演示条目。')}><Icon size={14}/></button></div><b>{asset.name}</b><small>{asset.use}</small><footer><span>{asset.id ? '项目参考' : `引用 ${index % 4 + 1} 处`}</span><button className="text-link" onClick={() => onAction(`「${asset.name}」的引用镜头列表尚未连接服务端。`)}>查看引用</button></footer></div></Panel>;
}
