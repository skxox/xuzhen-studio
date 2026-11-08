import { Check, Circle, Dot } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { StageState } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { stageRoute } from './stageRoutes';

export function ProductionStages({ stages = [] }: { stages?: StageState[] }) {
  const completed = stages.filter((stage) => ['accepted', 'waived'].includes(stage.status)).length;
  const active = stages.find((stage) => ['running', 'needs_review'].includes(stage.status));
  return (
    <div className="production-stages" aria-label="项目制作阶段">
      {stages.map((stage, index) => {
        const state = stageState(stage.status);
        const unavailableReason = stage.unavailable_reason ?? undefined;
        return (
          <StageEntry
            key={stage.id}
            stage={stage}
            state={state}
            unavailableReason={unavailableReason}
          >
            <span className="production-stage__mark">
              {state === 'done' ? (
                <Check size={11} />
              ) : state === 'active' ? (
                <Dot size={19} />
              ) : (
                <Circle size={8} />
              )}
            </span>
            <span>{stage.label}</span>
            {index < stages.length - 1 && (
              <i className={`production-stage__line ${state === 'done' ? 'is-done' : ''}`} />
            )}
          </StageEntry>
        );
      })}
      <Badge tone={active?.status === 'needs_review' ? 'gold' : 'neutral'}>
        {completed} / {stages.length} 已完成
      </Badge>
    </div>
  );
}

function StageEntry({
  stage,
  state,
  unavailableReason,
  children,
}: {
  stage: StageState;
  state: string;
  unavailableReason?: string;
  children: ReactNode;
}) {
  const className = `production-stage production-stage--${state}${unavailableReason ? ' is-unavailable' : ''}`;
  const title = unavailableReason ?? `${stage.label} · ${statusLabel(stage.status)}`;
  if (unavailableReason) {
    return (
      <span className={className} title={title} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link to={stageRoute(stage.stage_key)} title={title} className={className}>
      {children}
    </Link>
  );
}

function stageState(status: StageState['status']) {
  if (status === 'accepted' || status === 'waived') return 'done';
  if (status === 'running' || status === 'needs_review') return 'active';
  return 'next';
}

function statusLabel(status: StageState['status']) {
  const labels: Record<StageState['status'], string> = {
    not_started: '未开始',
    ready: '可开始',
    running: '进行中',
    needs_review: '等待审阅',
    accepted: '已验收',
    waived: '已豁免',
    blocked: '被阻塞',
    stale: '需要更新',
    failed: '执行失败',
  };
  return labels[status];
}
