import { useState } from 'react';
import { Aperture, ArrowDownToLine, AudioLines, FileImage, Filter, ImagePlus, Plus, Search, SlidersHorizontal, Sparkles, Video } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';

const assets = [
  { name: '宴会厅 · 主视角', type: '场景', version: 'v04', use: '本集 4 个镜头', tone: 'scene' },
  { name: '王云飞 · 黑色西装', type: '角色', version: 'v02', use: '第 1 季 · 21 镜', tone: 'person' },
  { name: '秦老太太 · 正面', type: '角色', version: 'v03', use: '第 1 季 · 8 镜', tone: 'portrait' },
  { name: '宴会桌 · 青瓷酒杯', type: '道具', version: 'v01', use: '第 3 集 · 3 镜', tone: 'prop' },
  { name: '镜头 01 · 关键帧', type: '关键帧', version: 'v03', use: 'Shot 01 · 16:9', tone: 'frame' },
  { name: '萧家老宅 · 俯视空间图', type: '场景', version: 'v02', use: '美术圣经', tone: 'blueprint' },
];

export function AssetsPage() {
  const [filter, setFilter] = useState('全部');
  const visible = assets.filter((asset) => filter === '全部' || asset.type === filter);
  return <div className="assets-page"><PageHeading eyebrow="ASSET LIBRARY" title="场景、角色与镜头，共用一套素材版本。" description="每个生成任务引用精确的素材版本、用途与权重。替换资产时可查看受影响的下游镜头。" actions={<><Button icon={<ArrowDownToLine size={15}/>}>导入素材</Button><Button variant="primary" icon={<Plus size={15}/>}>新建资产卡</Button></>} />
    <div className="asset-summary"><div><span className="asset-summary__mark"><Aperture size={17}/></span><b>第一季 · 美术圣经</b><Badge tone="green">v04 已确认</Badge></div><p>目前共有 38 项资产 · 12 个角色 · 8 个场景 · 6 个关键道具 · 风格参考 4 组</p><button className="text-link">查看美术设定 <Sparkles size={13}/></button></div>
    <div className="asset-controls"><div className="asset-filters">{['全部', '角色', '场景', '道具', '关键帧'].map((item) => <button key={item} className={filter === item ? 'is-active' : ''} onClick={() => setFilter(item)}>{item}{item === '全部' && <small>38</small>}</button>)}</div><div className="asset-search"><Search size={15}/><input placeholder="搜索资产名称、别名或版本"/></div><button className="quiet-action"><Filter size={14}/>引用状态</button><button className="plain-icon" aria-label="资产筛选"><SlidersHorizontal size={15}/></button></div>
    <div className="asset-grid">{visible.map((asset, index) => <AssetCard key={asset.name} asset={asset} index={index}/>)}</div>
    <Panel className="asset-provenance"><div><FileImage size={16}/><span><b>资产出处与授权记录</b><small>角色与场景的关键事实保留来源；AI 生成资产记录模型、提示词版本和引用素材。</small></span></div><Badge>审计记录已启用</Badge></Panel>
  </div>;
}

function AssetCard({ asset, index }: { asset: typeof assets[number]; index: number }) {
  const Icon = asset.type === '关键帧' ? Video : asset.type === '角色' ? AudioLines : ImagePlus;
  return <Panel className="asset-card"><button className={`asset-visual asset-visual--${asset.tone}`} aria-label={`打开${asset.name}`}><div className="asset-visual__shape"/><span className="asset-visual__index">A{String(index + 1).padStart(2, '0')}</span><span className="asset-version">{asset.version}</span></button><div className="asset-card__body"><div><Badge tone={asset.type === '角色' ? 'violet' : asset.type === '关键帧' ? 'gold' : 'blue'}>{asset.type}</Badge><button className="plain-icon" aria-label={`${asset.name}选项`}><Icon size={14}/></button></div><b>{asset.name}</b><small>{asset.use}</small><footer><span>引用 {index % 4 + 1} 处</span><button className="text-link">查看引用</button></footer></div></Panel>;
}
