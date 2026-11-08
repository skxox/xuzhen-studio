import { MoreHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/Badge';

export function ReferenceItem({
  name,
  type,
  tag,
  color,
  onRemove,
}: {
  name: string;
  type: string;
  tag: string;
  color: string;
  onRemove?: () => void;
}) {
  const [note, setNote] = useState('只参考空间关系与光线方向');
  return (
    <article className="reference-item">
      <div className={`reference-art ${color}`}>
        <span>{type === '角色' ? '人' : '景'}</span>
      </div>
      <div className="reference-item__body">
        <div className="reference-item__title">
          <span>{name}</span>
          <button className="plain-icon" aria-label="素材更多操作">
            <MoreHorizontal size={15} />
          </button>
        </div>
        <div className="reference-item__meta">
          <Badge tone={type === '角色' ? 'violet' : 'blue'}>{type}</Badge>
          <span>{tag}</span>
        </div>
        <input
          aria-label={`${name}参考说明`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {onRemove && (
        <button className="reference-remove" aria-label={`移除${name}`} onClick={onRemove}>
          <X size={13} />
        </button>
      )}
    </article>
  );
}
