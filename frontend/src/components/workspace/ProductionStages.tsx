import { Check, ChevronRight, Circle, Dot } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/Badge';

const stages = [
  { name: '原文导入', state: 'done', to: '/source' },
  { name: '故事改编', state: 'done', to: '/writing' },
  { name: '角色美术', state: 'done', to: '/writing' },
  { name: '分集剧本', state: 'done', to: '/writing' },
  { name: '分镜设计', state: 'active', to: '/storyboard' },
  { name: '关键帧', state: 'next', to: '/storyboard' },
  { name: '视频生成', state: 'next', to: '/storyboard' },
  { name: '后期交付', state: 'next', to: '/delivery' },
];

export function ProductionStages() {
  return (
    <div className="production-stages" aria-label="本集制作阶段">
      {stages.map((stage, index) => (
        <Link
          key={stage.name}
          to={stage.to}
          className={`production-stage production-stage--${stage.state}`}
        >
          <span className="production-stage__mark">
            {stage.state === 'done' ? (
              <Check size={11} />
            ) : stage.state === 'active' ? (
              <Dot size={19} />
            ) : (
              <Circle size={8} />
            )}
          </span>
          <span>{stage.name}</span>
          {index < stages.length - 1 && (
            <i className={`production-stage__line ${stage.state === 'done' ? 'is-done' : ''}`} />
          )}
        </Link>
      ))}
      <Badge tone="gold">第 5 / 8 阶段</Badge>
    </div>
  );
}

export function StageGateSummary({ label = '分镜门禁' }: { label?: string }) {
  return (
    <div className="gate-summary">
      <span className="gate-summary__icon">
        <Check size={14} />
      </span>
      <span>
        <b>{label} · 可送审</b>
        <small>4 / 4 个节拍已映射 · 1 项连续性提醒待确认</small>
      </span>
      <ChevronRight size={15} />
    </div>
  );
}
