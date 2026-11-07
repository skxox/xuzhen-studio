import { useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, CircleHelp, Copy, ImagePlus,
  MessageSquareText, MoreHorizontal, RefreshCw, ScanSearch, WandSparkles,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button, IconButton } from '../components/ui/Button';
import { Field, SelectInput, TextArea } from '../components/ui/Field';
import { Panel } from '../components/ui/Panel';
import { ClipPreview } from '../components/workspace/ClipPreview';
import { ProductionStages, StageGateSummary } from '../components/workspace/ProductionStages';
import { AddShotCard, ShotCard, type Shot } from '../components/workspace/ShotCard';
import { ReferenceItem } from '../components/workspace/ReferenceItem';

const initialShots: Shot[] = [
  { id: 'sh-01', number: 1, duration: '2.5', size: '中景', angle: '东南侧', movement: '固定机位', beat: '节拍 09 · 建立关系', image: 'visual-frame--hall', state: 'ready', prompt: '王云飞靠在厅东大圆桌东南侧的椅背上，右手端着酒杯，目光从杯沿抬向主位。画面保留人物与主位的空间关系。' },
  { id: 'sh-02', number: 2, duration: '6.0', size: '近景', angle: '平视', movement: '缓慢推近', beat: '节拍 09 · 反应镜头', image: 'visual-frame--portrait', state: 'review', prompt: '秦老太太抬眼望向桌边，手指轻敲桌面。窗棂侧光落在眼睛与手部，背景来宾保持虚化。' },
  { id: 'sh-03', number: 3, duration: '3.5', size: '特写', angle: '正反打', movement: '固定机位', beat: '节拍 10 · 情绪转折', image: 'visual-frame--warm', state: 'draft', prompt: '萧初然停下脚步，目光越过人群落在王云飞身上。手中的文件被她轻轻握紧。' },
  { id: 'sh-04', number: 4, duration: '4.0', size: '全景', angle: '主位方向', movement: '缓慢横移', beat: '节拍 10 · 进入对白', image: 'visual-frame--wide', state: 'draft', prompt: '镜头沿圆桌缓慢横移，桌边交谈声渐弱，众人将注意力转向主位。' },
];

export function StoryboardPage() {
  const [shots, setShots] = useState(initialShots);
  const [selectedId, setSelectedId] = useState(initialShots[0].id);
  const [toast, setToast] = useState('');
  const [view, setView] = useState<'shots' | 'coverage'>('shots');
  const selected = useMemo(() => shots.find((shot) => shot.id === selectedId) ?? shots[0], [selectedId, shots]);
  const updateSelected = (field: 'duration' | 'size' | 'angle' | 'movement' | 'prompt', value: string) => setShots((items) => items.map((shot) => shot.id === selectedId ? { ...shot, [field]: value, state: 'draft' } : shot));
  const addShot = () => {
    const nextNumber = shots.length + 1;
    const next: Shot = { id: `sh-${String(nextNumber).padStart(2, '0')}`, number: nextNumber, duration: '3.0', size: '中景', angle: '平视', movement: '固定机位', beat: `节拍 ${9 + nextNumber} · 待映射`, image: 'visual-frame--wide', state: 'draft', prompt: '' };
    setShots((items) => [...items, next]); setSelectedId(next.id); setToast('已添加空白镜头，请关联节拍并补充画面描述。');
  };
  const markAccepted = () => { setShots((items) => items.map((shot) => shot.id === selectedId ? { ...shot, state: 'ready' } : shot)); setToast(`Shot ${selected.number} 已在本地工作区标记为确认；尚未写入服务端。`); };

  return <div className="storyboard-page">
    <div className="workbench-titlebar"><div><div className="eyebrow">EPISODE 01-03 <span>·</span> SHOT DESIGN</div><h1>镜头，逐格成形。</h1><p>从已确认的剧本节拍拆出可拍摄镜头，审阅连续性，再交给图像与视频服务。</p></div>
      <div className="titlebar-actions"><Badge tone="gold" dot>AI 预拟 · 人工审阅</Badge><Button icon={<MessageSquareText size={15} />} onClick={() => setToast('当前有 2 条本地演示批注；服务端批注 API 尚未接入。')}>审阅批注 <span className="button-count">2</span></Button><Button variant="primary" icon={<ScanSearch size={15} />} onClick={() => setToast('门禁扫描已完成：节拍已覆盖，轴线提醒仍需人工确认。')}>检查分镜</Button></div>
    </div>
    <ProductionStages />
    <div className="workbench-toolbar"><div className="toolbar-tabs" role="tablist" aria-label="分镜视图">
      <button role="tab" aria-selected={view === 'shots'} className={view === 'shots' ? 'is-active' : ''} onClick={() => setView('shots')}>逐镜设计 <span>04</span></button>
      <button role="tab" aria-selected={view === 'coverage'} className={view === 'coverage' ? 'is-active' : ''} onClick={() => setView('coverage')}>节拍覆盖 <span className="coverage-alert">1</span></button>
    </div><div className="toolbar-selectors"><label>文本模型 <select aria-label="文本模型"><option>DeepSeek V4 Pro</option><option>项目默认服务</option></select></label><label>图片服务 <select aria-label="图片服务"><option>ComfyUI · Qwen Image</option><option>项目默认服务</option></select></label><label>视频服务 <select aria-label="视频服务"><option>待配置</option><option>项目默认服务</option></select></label><span className="toolbar-divider"/><button className="quiet-action" onClick={() => setToast('生成参数继承项目设置；此演示界面尚未向 Provider 提交任务。')}><WandSparkles size={15}/>参数与服务</button></div></div>
    {view === 'coverage' ? <CoverageReview shots={shots} onSelect={(id) => { setSelectedId(id); setView('shots'); }} /> : <>
      <div className="workbench-content">
        <section className="shot-workspace">
          <div className="workspace-subhead"><div><h2>宴会厅 · 主线冲突</h2><span>第 9–10 节拍 · 4 个镜头 · 16.0 秒</span></div><div className="subhead-controls"><button className="quiet-action" onClick={() => setToast('筛选器：显示全部镜头。更细筛选将在镜头标签和状态持久化后启用。')}><SlidersLabel /> 镜头筛选</button><button className="quiet-action" onClick={() => setToast('已按剧本节拍顺序排列。')}><ArrowDown size={14}/>按节拍排序</button><IconButton label="更多"><MoreHorizontal size={16}/></IconButton></div></div>
          <StageGateSummary />
          <div className="shot-grid">{shots.map((shot) => <ShotCard key={shot.id} shot={shot} selected={shot.id === selectedId} onSelect={() => setSelectedId(shot.id)} />)}<AddShotCard onClick={addShot} /></div>
          <div className="shot-batch-bar"><div><span className="batch-index">01</span><span>第 1 批 · 剧本节拍 09–10</span><Badge tone="green">4 镜已拆解</Badge></div><button className="quiet-action" onClick={() => setToast('AI 镜头拆解需要先接入文本 Provider。当前不会伪造生成结果。')}><WandSparkles size={14}/>AI 补全未覆盖内容</button></div>
        </section>
        <aside className="inspector-column">
          <Panel className="preview-panel"><div className="panel-heading"><div><div className="eyebrow">SEQUENCE PREVIEW</div><h3>连续性预览</h3></div><button className="plain-icon" aria-label="预览设置"><MoreHorizontal size={16}/></button></div><ClipPreview />
            <div className="mini-shot-strip">{shots.map((shot) => <button key={shot.id} className={`mini-shot ${shot.id === selectedId ? 'is-current' : ''}`} onClick={() => setSelectedId(shot.id)}><div className={`visual-frame ${shot.image}`}><div className="frame-window"/><div className="frame-figure"/><div className="frame-furniture"/></div><span>{String(shot.number).padStart(2, '0')} <small>{shot.duration}s</small></span></button>)}</div>
          </Panel>
          <Panel className="shot-inspector"><div className="inspector-title"><div><div className="eyebrow">SHOT {String(selected.number).padStart(2, '0')} · VERSION 03</div><h3>镜头控制</h3></div><Badge tone={selected.state === 'ready' ? 'green' : 'gold'} dot>{selected.state === 'ready' ? '已确认' : '待审阅'}</Badge></div>
            <div className="inspector-fields"><div className="inspector-row"><Field label="时长（秒）"><input className="compact-input" value={selected.duration} onChange={(event) => updateSelected('duration', event.target.value)} /></Field><Field label="景别"><SelectInput value={selected.size} onChange={(event) => updateSelected('size', event.target.value)}><option>全景</option><option>中景</option><option>近景</option><option>特写</option></SelectInput></Field></div>
              <div className="inspector-row"><Field label="机位方向"><SelectInput value={selected.angle} onChange={(event) => updateSelected('angle', event.target.value)}><option>东南侧</option><option>平视</option><option>主位方向</option><option>正反打</option></SelectInput></Field><Field label="运镜"><SelectInput value={selected.movement} onChange={(event) => updateSelected('movement', event.target.value)}><option>固定机位</option><option>缓慢推近</option><option>缓慢横移</option><option>跟拍</option></SelectInput></Field></div>
              <Field label="画面描述 · Picture Prompt"><TextArea rows={4} value={selected.prompt} onChange={(event) => updateSelected('prompt', event.target.value)} placeholder="写清主体、动作、空间关系、光线与情绪" /></Field>
              <Field label="视频动作 · Motion Prompt"><TextArea rows={3} defaultValue="角色只做轻微动作，镜头保持稳定，动作方向承接上一镜。" /></Field>
            </div>
            <div className="inspector-reference-head"><span>引用素材 <small>2 / 10</small></span><button className="text-link" onClick={() => setToast('素材选择器将在素材库连接完成后加入。')}><ImagePlus size={14}/>添加</button></div>
            <div className="reference-list"><ReferenceItem name="宴会厅主场景" type="场景" tag="主视角 · v04" color="ref-art--scene"/><ReferenceItem name="王云飞" type="角色" tag="西装造型 · v02" color="ref-art--person"/></div>
            <div className="inspector-footer"><Button size="sm" icon={<Copy size={14}/>} onClick={() => setToast('镜头参数已复制到剪贴板缓存。')}>复制参数</Button><span/><Button size="sm" onClick={() => setToast('已保存到本地界面状态；后端候选版本 API 尚未接入。')}>保存草稿</Button><Button size="sm" variant="primary" icon={<Check size={14}/>} onClick={markAccepted}>确认本镜</Button></div>
          </Panel>
          <ContinuityNote onResolve={() => setToast('连续性问题已标记为“需人工复核”，未自动豁免。')} />
        </aside>
      </div>
      <div className="workbench-footer"><span><span className="live-dot"/>自动保存至本地界面状态 <span className="footer-sep">·</span> 镜头版本 v03</span><span>当前剧本版本 SR-12 <span className="footer-sep">·</span> 角色设定 v04</span><div><button className="quiet-action"><ArrowUp size={14}/>上一个阶段</button><Button variant="primary" icon={<ChevronDown size={14}/>} onClick={() => setToast('分镜检查通过后可提交关键帧阶段；需先处理连续性提醒。')}>提交阶段验收</Button></div></div>
    </>}
    {toast && <div className="toast" role="status"><span className="toast-mark"><Check size={13}/></span>{toast}<button aria-label="关闭提示" onClick={() => setToast('')}>×</button></div>}
  </div>;
}

function SlidersLabel() { return <span className="slider-glyph">☷</span>; }

function CoverageReview({ shots, onSelect }: { shots: Shot[]; onSelect: (id: string) => void }) {
  const beats = ['建立宴会空间与人物位置', '王云飞沉默观察主位', '秦老太太抬眼，全场安静', '萧初然握紧文件，情绪转折'];
  return <Panel className="coverage-panel"><div className="coverage-heading"><div><div className="eyebrow">SCRIPT → SHOT TRACE</div><h2>节拍覆盖与出处</h2><p>每个必需节拍需映射至少一个镜头；未覆盖项应补镜或写明豁免理由。</p></div><Badge tone="gold">1 项需处理</Badge></div>
    <div className="coverage-table"><div className="coverage-table__head"><span>剧本节拍</span><span>镜头映射</span><span>原文 / 改编依据</span><span>检查状态</span></div>{beats.map((beat, index) => <div className="coverage-row" key={beat}><span><b>{String(index + 9).padStart(2, '0')}</b>{beat}</span><button className="coverage-link" onClick={() => shots[index] && onSelect(shots[index].id)}>{shots[index] ? `Shot ${String(shots[index].number).padStart(2, '0')} · ${shots[index].duration}s` : '＋ 关联镜头'}</button><span className="source-chip">第 18 章 · 段落 {12 + index}</span><Badge tone={index === 3 ? 'gold' : 'green'} dot>{index === 3 ? '需复核方向' : '已覆盖'}</Badge></div>)}</div>
    <div className="coverage-note"><CircleHelp size={16}/><span>镜头覆盖只证明结构映射，不代表模型质量通过。接受/豁免记录将锁定本次剧本版本。</span></div>
  </Panel>;
}

function ContinuityNote({ onResolve }: { onResolve: () => void }) {
  return <Panel className="continuity-note"><div className="continuity-note__icon"><RefreshCw size={15}/></div><div><div className="continuity-note__title"><b>连续性提醒</b><Badge tone="gold">中风险</Badge><button className="plain-icon" aria-label="连续性问题操作"><MoreHorizontal size={15}/></button></div><p>Shot 02 到 Shot 03 的视线方向可能越轴。建议核对人物坐标，或增加过渡镜头。</p><button className="text-link" onClick={onResolve}>打开 finding · 查看依据 <ChevronDown size={13}/></button></div></Panel>;
}
