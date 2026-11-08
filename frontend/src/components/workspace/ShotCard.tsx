import { Check, GripVertical, MoreHorizontal, Plus } from 'lucide-react';
import { Badge } from '../ui/Badge';

export interface Shot {
  id: string;
  number: number;
  duration: string;
  size: string;
  angle: string;
  movement: string;
  beat: string;
  prompt: string;
  image: string;
  state: 'ready' | 'draft' | 'review';
}

export function ShotCard({
  shot,
  selected,
  onSelect,
}: {
  shot: Shot;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`shot-card ${selected ? 'is-selected' : ''}`} onClick={onSelect}>
      <div className="shot-card__top">
        <span className="shot-order">
          <GripVertical size={13} />
          {String(shot.number).padStart(2, '0')}
        </span>
        <span className="shot-time">{shot.duration}s</span>
        <Badge
          tone={shot.state === 'ready' ? 'green' : shot.state === 'review' ? 'gold' : 'neutral'}
          dot
        >
          {shot.state === 'ready' ? '已确认' : shot.state === 'review' ? '待审阅' : '草稿'}
        </Badge>
        <button
          className="shot-more"
          aria-label={`镜头 ${shot.number} 更多操作`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="shot-card__media">
        <div className={`visual-frame ${shot.image}`}>
          <div className="frame-window" />
          <div className="frame-figure" />
          <div className="frame-furniture" />
        </div>
        <span className="frame-label">关键帧 {String(shot.number).padStart(2, '0')}</span>
      </div>
      <div className="shot-card__content">
        <div className="shot-tags">
          <span>{shot.size}</span>
          <span>{shot.angle}</span>
          <span>{shot.movement}</span>
        </div>
        <p>{shot.prompt}</p>
        <div className="shot-card__foot">
          <span>{shot.beat}</span>
          {shot.state === 'ready' && <Check size={14} />}
        </div>
      </div>
    </article>
  );
}

export function AddShotCard({ onClick }: { onClick: () => void }) {
  return (
    <button className="add-shot-card" onClick={onClick}>
      <span>
        <Plus size={18} />
      </span>
      <b>添加镜头</b>
      <small>从未映射节拍继续拆镜</small>
    </button>
  );
}
