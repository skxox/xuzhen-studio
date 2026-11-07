import { useState } from 'react';
import { ArrowRight, BadgeCheck, Circle, GitBranch, MoreHorizontal, Plus, RefreshCw, Sparkles, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';

const nodes = [
  { id: '01', title: '故事来源锁定', stage: 'SOURCE', state: 'complete', io: '18 章 · StorySource v07', icon: 'book', x: '4%', y: '20%' },
  { id: '02', title: '视频改编大纲', stage: 'ADAPTATION', state: 'complete', io: '12 集卡 · Outline v04', icon: 'text', x: '25%', y: '20%' },
  { id: '03', title: '角色 / 美术圣经', stage: 'DESIGN', state: 'complete', io: '6 角色 · 8 场景', icon: 'design', x: '48%', y: '9%' },
  { id: '04', title: '分集剧本', stage: 'SCRIPT', state: 'complete', io: '第 3 集 · Script v12', icon: 'text', x: '48%', y: '44%' },
  { id: '05', title: 'AI 拆镜计划', stage: 'SHOT PLAN', state: 'active', io: '4 Shot · 1 finding', icon: 'ai', x: '70%', y: '44%' },
  { id: '06', title: '关键帧候选', stage: 'IMAGE', state: 'locked', io: '等待分镜门禁', icon: 'image', x: '88%', y: '9%' },
  { id: '07', title: '逐镜视频', stage: 'VIDEO', state: 'locked', io: '等待关键帧验收', icon: 'video', x: '88%', y: '68%' },
  { id: '08', title: '配音 / 成片', stage: 'DELIVERY', state: 'locked', io: '等待视频候选', icon: 'export', x: '70%', y: '78%' },
];

export function CanvasPage() {
  const [notice, setNotice] = useState('');
  return <div className="canvas-page"><PageHeading eyebrow="PRODUCTION GRAPH" title="制作流程，是可以被看见和调整的。" description="AI 先基于剧本与设定预拟生成计划。你可以审阅、改节点参数与引用，批准后才会执行；不需要手动画图才能生产。" actions={<><Badge tone="gold" dot>计划待审阅 · v03</Badge><Button variant="primary" icon={<BadgeCheck size={15}/>} onClick={() => setNotice('计划审批 API 尚未接入，当前画布只用于预览与交互评审。')}>批准计划</Button></>} />
    <div className="canvas-toolbar"><div><span><span className="live-dot"/>AI 规划快照</span><span>·</span><span>来源：第 3 集剧本 v12</span><span>·</span><span>更新于 14:32</span></div><div><button className="quiet-action"><GitBranch size={14}/>依赖视图</button><button className="quiet-action"><RefreshCw size={14}/>重新规划</button><button className="plain-icon" aria-label="画布选项"><MoreHorizontal size={16}/></button></div></div>
    <div className="canvas-layout"><Panel className="graph-panel"><div className="graph-world"><svg className="graph-connections" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true"><path d="M155 188 C220 188 225 188 295 188"/><path d="M390 188 C465 188 456 104 520 104"/><path d="M390 188 C465 188 456 334 520 334"/><path d="M620 104 C695 104 680 334 745 334"/><path d="M620 334 C688 334 680 334 745 334"/><path d="M850 334 C910 334 884 110 920 110"/><path d="M850 334 C910 334 884 500 920 500"/><path d="M920 158 C920 310 920 352 920 448"/><path d="M850 500 C879 500 885 500 920 500"/></svg>
      {nodes.map((node) => <div key={node.id} className={`graph-node graph-node--${node.state}`} style={{ left: node.x, top: node.y }}><div className="graph-node__head"><span>{node.state === 'complete' ? <BadgeCheck size={14}/> : node.state === 'active' ? <Sparkles size={14}/> : <Circle size={11}/>}</span><small>{node.stage}</small><button aria-label={`${node.title}选项`}><MoreHorizontal size={15}/></button></div><b>{node.title}</b><span className="graph-node__io">{node.io}</span><div className="graph-node__foot"><span>{node.state === 'complete' ? '已验收' : node.state === 'active' ? '待人工审阅' : '门禁锁定'}</span>{node.state === 'active' && <Link to="/storyboard">打开 <ArrowRight size={12}/></Link>}</div></div>)}
      <button className="graph-add-node" style={{ left: '38%', top: '72%' }}><Plus size={13}/> 添加审阅步骤</button>
      <div className="graph-legend"><span><i className="legend-dot is-complete"/>已确认</span><span><i className="legend-dot is-active"/>待审阅</span><span><i className="legend-dot is-locked"/>未解锁</span></div>
    </div></Panel>
      <aside className="graph-inspector"><Panel className="plan-card"><div className="eyebrow">AI-PROPOSED PLAN</div><h3>第 3 集 · 生成计划</h3><p>剧本中的 4 个节拍已展开成 4 个镜头。计划使用已确认角色与宴会厅素材，不会越过门禁自动开始图像或视频生成。</p><div className="plan-stats"><span><b>4</b><small>镜头</small></span><span><b>2</b><small>参考素材</small></span><span><b>1</b><small>待复核 finding</small></span></div><div className="plan-checks"><PlanCheck title="剧本版本锁定" detail="Script v12"/><PlanCheck title="关键节拍已覆盖" detail="4 / 4"/><PlanCheck title="连续性检查" detail="1 项需确认" warn/><PlanCheck title="服务权限与能力" detail="视频服务未配置" warn/></div><div className="plan-actions"><Button variant="primary">审阅计划修改</Button><Button>保存为分镜草稿</Button></div></Panel>
      <Panel className="graph-help"><Workflow size={16}/><div><b>人工控制点</b><p>节点可以重排和改参数；连线说明依赖。被锁定的下游节点不能绕过阶段验收。</p><button className="text-link">阅读画布规则 <ArrowRight size={13}/></button></div></Panel></aside>
    </div>
    {notice && <div className="toast" role="status"><span className="toast-mark">!</span>{notice}<button onClick={() => setNotice('')} aria-label="关闭">×</button></div>}
  </div>;
}

function PlanCheck({ title, detail, warn }: { title: string; detail: string; warn?: boolean }) {
  return <div className={`plan-check ${warn ? 'has-warning' : ''}`}><span>{warn ? '!' : '✓'}</span><b>{title}</b><small>{detail}</small></div>;
}
import { useState } from 'react';
