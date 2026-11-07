import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleHelp, Copy, FileText, Plus, Sparkles, Undo2 } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, TextArea } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';

const scenes = [
  { id: 'S01', time: '夜 · 内', place: '萧家老宅 · 宴会厅', beat: '王云飞沉默观察，宴会气氛逐渐凝住', lines: 4, length: '00:32' },
  { id: 'S02', time: '夜 · 内', place: '宴会厅 · 圆桌主位', beat: '秦老太太抬眼，宣布宴会真正目的', lines: 6, length: '00:48' },
  { id: 'S03', time: '夜 · 内', place: '宴会厅 · 入口', beat: '萧初然握紧文件，第一次站到王云飞身边', lines: 3, length: '00:26' },
];

export function WritingPage() {
  const [tab, setTab] = useState<'outline' | 'script' | 'dialogue'>('script');
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState('');
  return <div className="writing-page">
    <PageHeading eyebrow="STORY DEVELOPMENT" title="让故事变成可拍的场次。" description="大纲、场次、节拍与对白各自版本化。每项改编都保留小说出处或明确标注为新增。" actions={<><Badge tone="green" dot>剧本 v12 · 已确认</Badge><Button variant="primary" icon={<Sparkles size={15}/>} onClick={() => setToast('剧本生成需要已验收的大纲、角色、美术和文本 Provider。当前没有提交模型任务。')}>生成候选</Button></>} />
    <div className="writing-kpis"><WritingKpi label="剧本来源" value="小说章节 18–21" detail="改编分支 AB-03 · 锁定版本 07"/><WritingKpi label="目标时长" value="02:00" detail="估算 01:46 · 误差 ± 12 秒"/><WritingKpi label="来源覆盖" value="84%" detail="新增对白 6 行 · 均已标记"/><WritingKpi label="待处理 finding" value="02" detail="时长预算 · 一处角色动机" alert/></div>
    <div className="writing-layout"><Panel className="script-outline"><div className="panel-heading"><div><div className="eyebrow">EPISODE STRUCTURE</div><h3>第 3 集 · 宴会</h3><p>本集目标：让王云飞的克制与家族轻视形成反差。</p></div><button className="plain-icon" aria-label="添加场次" onClick={() => setToast('新增场次草稿已在本地界面状态创建。')}><Plus size={17}/></button></div>
      <div className="scene-list">{scenes.map((scene, index) => <button key={scene.id} onClick={() => setSelected(index)} className={`scene-row ${selected === index ? 'is-selected' : ''}`}><span className="scene-row__index">{scene.id}</span><span className="scene-row__body"><b>{scene.place}</b><small>{scene.time} · {scene.beat}</small><span className="scene-row__meta">{scene.lines} 句对白 <i/> {scene.length}</span></span><span className="scene-row__handle">⠿</span></button>)}</div>
      <button className="add-scene" onClick={() => setToast('新增场次草稿已在本地界面状态创建。')}><Plus size={15}/>添加场次</button>
      <div className="script-outline__footer"><span><FileText size={14}/>本集映射 4 个原文段落</span><button className="text-link">查看改编映射 <ChevronDown size={14}/></button></div>
    </Panel>
    <section className="script-editor"><div className="editor-toolbar"><div className="toolbar-tabs" role="tablist"><button role="tab" aria-selected={tab === 'outline'} className={tab === 'outline' ? 'is-active' : ''} onClick={() => setTab('outline')}>分集卡</button><button role="tab" aria-selected={tab === 'script'} className={tab === 'script' ? 'is-active' : ''} onClick={() => setTab('script')}>场次剧本</button><button role="tab" aria-selected={tab === 'dialogue'} className={tab === 'dialogue' ? 'is-active' : ''} onClick={() => setTab('dialogue')}>对白表</button></div><div><button className="quiet-action" onClick={() => setToast('此版本标记已写入本地界面状态。')}><Copy size={14}/>复制</button><button className="plain-icon" aria-label="撤销" onClick={() => setToast('当前版本尚无可恢复的编辑历史。')}><Undo2 size={15}/></button></div></div>
      {tab === 'outline' ? <OutlineEditor onToast={setToast}/> : tab === 'dialogue' ? <DialogueEditor onToast={setToast}/> : <SceneEditor selected={selected} onToast={setToast}/ >}
    </section>
    <Panel className="writing-inspector"><div className="panel-heading"><div><div className="eyebrow">QUALITY GATES</div><h3>剧本门禁</h3></div><Badge tone="gold">待复核</Badge></div>
      <GateItem status="pass" title="场次结构完整" detail="3 个场次 · 均有戏剧目标"/><GateItem status="pass" title="人物行为边界" detail="已引用角色圣经 v04"/><GateItem status="warning" title="对白时长预算" detail="第 2 场预计超时 8 秒"/><GateItem status="warning" title="改编出处覆盖" detail="6 行新对白需标记改编理由"/>
      <div className="gate-action"><Button variant="primary" onClick={() => setToast('2 项 finding 仍需逐条处理后才能验收剧本阶段。')}>查看 2 项问题 <ChevronDown size={14}/></Button><small>门禁结果基于可验证规则；模型自评不作为通过凭证。</small></div>
      <div className="source-mapping"><div className="eyebrow">SOURCE MAPPING</div><b>第 19 章 · 宴席上的客人</b><p>段落 04–09 → 场次 02 → Beat 05–08</p><button className="text-link" onClick={() => setToast('原文定位将在 SourceSpan API 接入后跳转到具体段落。')}>打开原文定位 <ArrowUp size={13}/></button></div>
    </Panel></div>
    {toast && <div className="toast" role="status"><span className="toast-mark"><Check size={13}/></span>{toast}<button aria-label="关闭提示" onClick={() => setToast('')}>×</button></div>}
  </div>;
}

function WritingKpi({ label, value, detail, alert }: { label: string; value: string; detail: string; alert?: boolean }) {
  return <Panel className={`writing-kpi ${alert ? 'has-alert' : ''}`}><small>{label}</small><b>{value}</b><span>{detail}</span></Panel>;
}

function SceneEditor({ selected, onToast }: { selected: number; onToast: (message: string) => void }) {
  const scene = scenes[selected];
  return <div className="scene-editor"><div className="scene-editor__heading"><div><Badge tone="blue">{scene.id} · 场次</Badge><span className="scene-editor__location">{scene.time} · {scene.place}</span></div><span>版本 v03 · 本地草稿</span></div>
    <div className="screenplay"><p className="screenplay-direction">【动作】 宴会厅里觥筹交错。王云飞靠着圆桌，指间轻晃着酒杯。他没有加入谈话。</p><div className="screenplay-cue">王云飞 <span>（克制，观察）</span></div><p className="screenplay-dialogue">不用急着解释。先听奶奶把话说完。</p><div className="screenplay-source"><FileText size={13}/>改编对白 · 基于第 19 章段落 06 · 非原文逐字引用</div><p className="screenplay-direction">秦老太太抬起眼，手指停在桌面。邻座的说笑声慢慢消失。</p><div className="screenplay-cue">秦老太太 <span>（平静，带有试探）</span></div><p className="screenplay-dialogue">今天请大家来，是有件事要当面说清楚。</p><div className="screenplay-source source-original"><FileText size={13}/>原文对白 · 第 19 章段落 08 · 文字对齐</div></div>
    <div className="scene-beat-strip"><span>戏剧目标</span><b>建立宴会中的权力关系</b><i/><span>冲突</span><b>身份与家族期待错位</b><i/><span>转折</span><b>老太太宣布来意</b></div>
    <div className="scene-editor__footer"><Button size="sm" onClick={() => onToast('剧本修订已保存为本地草稿。')}>保存场次草稿</Button><Button size="sm" variant="primary" icon={<Check size={14}/>} onClick={() => onToast('场次需先通过时长和角色行为门禁，才能接受为剧本版本。')}>接受场次</Button></div>
  </div>;
}

function OutlineEditor({ onToast }: { onToast: (message: string) => void }) {
  return <div className="outline-editor"><div className="episode-card"><div className="episode-card__number">03</div><div><div className="eyebrow">EPISODE CARD · VERSION 04</div><h2>宴会 · 暴雨前的安静</h2><p>王云飞在萧家宴会上被轻视，却选择暂不揭露身份；秦老太太察觉关系异样，借宴会宣布一项安排，迫使萧初然做出回应。</p></div></div>
    <div className="outline-fields"><Field label="本集目标"><TextArea rows={2} defaultValue="建立家族权力关系；让观众看见王云飞主动克制，而非被动受辱。"/></Field><div className="form-row"><Field label="核心冲突"><TextArea rows={3} defaultValue="家族以身份和资源评判王云飞；萧初然必须在家庭期待与伴侣之间表态。"/></Field><Field label="结尾钩子"><TextArea rows={3} defaultValue="秦老太太提出的安排，将改变萧初然和王云飞的关系。"/></Field></div><div className="outline-constraints"><span><Check size={13}/>保留夫妻关系张力</span><span><Check size={13}/>不得提前揭露隐藏身份</span><span><CircleHelp size={13}/>第 19 章 · 段落 04–11</span></div><Button variant="primary" onClick={() => onToast('分集卡更新为本地草稿，未覆盖已确认版本。')}>保存分集卡草稿</Button></div>
  </div>;
}

function DialogueEditor({ onToast }: { onToast: (message: string) => void }) {
  return <div className="dialogue-editor"><div className="dialogue-tools"><span>12 行对白 · 原文 6 · 改编 / 新增 6</span><Button size="sm" onClick={() => onToast('对白 CSV 导出将在交付功能阶段接入。')}>导出对白表 <ArrowDown size={13}/></Button></div><table><thead><tr><th>场次</th><th>说话人</th><th>对白</th><th>情绪 / 动作</th><th>出处</th></tr></thead><tbody>{[
      ['S01', '王云飞', '先听奶奶把话说完。', '克制 · 观察', '改编 · 段落 06'],
      ['S01', '秦老太太', '今天请大家来，是有件事要说清楚。', '平静 · 试探', '原文 · 段落 08'],
      ['S02', '萧初然', '奶奶，您想说什么？', '迟疑 · 打断', '原文 · 段落 10'],
      ['S03', '王云飞', '这件事，我尊重你的决定。', '温和 · 退让', '新增 · 决策理由'],
    ].map((row) => <tr key={`${row[0]}-${row[1]}`} onClick={() => onToast(`${row[1]} 这行对白已选中。`)}>{row.map((cell, index) => <td key={cell} className={index === 4 && cell.startsWith('新增') ? 'new-line' : ''}>{cell}</td>)}</tr>)}</tbody></table><button className="add-dialogue" onClick={() => onToast('新增对白行草稿已创建。')}><Plus size={14}/>添加对白</button></div>;
}

function GateItem({ status, title, detail }: { status: 'pass' | 'warning'; title: string; detail: string }) {
  return <div className={`gate-item gate-item--${status}`}><span>{status === 'pass' ? <Check size={13}/> : <CircleHelp size={13}/>}</span><div><b>{title}</b><small>{detail}</small></div><button aria-label={`查看${title}`}><ChevronDown size={14}/></button></div>;
}
