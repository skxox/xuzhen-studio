import { AlertCircle, ArrowRight, BookOpen, LoaderCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Project, StageState } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { PageHeading, Panel } from '../components/ui/Panel';
import { ProductionStages } from '../components/workspace/ProductionStages';
import { stageRoute } from '../components/workspace/stageRoutes';
import { OriginalNovelOutlineWorkspace } from './OriginalNovelOutlineWorkspace';

export function WritingPage({ project }: { project?: Project }) {
  if (project?.creation_mode === 'original') {
    return <OriginalNovelOutlineWorkspace project={project} />;
  }

  return <AdaptationWritingPage project={project} />;
}

function AdaptationWritingPage({ project }: { project?: Project }) {
  const stagesQuery = useQuery({
    queryKey: ['stages', project?.id],
    queryFn: () => api.stages(project!.id),
    enabled: Boolean(project?.id),
  });
  const stages = stagesQuery.data ?? [];
  const currentStage = selectCurrentStage(stages);

  return (
    <div className="writing-page">
      <PageHeading
        eyebrow="STORY DEVELOPMENT"
        title="故事与剧本"
        description="从已确认的内容来源开始，沿制作阶段推进故事开发、剧本与镜头设计。每个阶段的状态和验收结果以项目数据为准。"
      />
      {!project ? (
        <Panel className="overview-empty">
          <BookOpen size={22} />
          <h2>先选择或创建一个项目</h2>
          <p>项目确定后，这里会展示它当前的故事制作阶段与下一步入口。</p>
          <Link to="/">
            返回制片总览 <ArrowRight size={14} />
          </Link>
        </Panel>
      ) : (
        <>
          <Panel className="writing-project-panel">
            <div className="writing-project-panel__heading">
              <div>
                <div className="eyebrow">当前项目</div>
                <h2>{project.name}</h2>
              </div>
              {currentStage && (
                <Badge tone={toneForStatus(currentStage.status)}>
                  {currentStage.label} · {statusLabel(currentStage.status)}
                </Badge>
              )}
            </div>
            {stagesQuery.isLoading ? (
              <div className="writing-state">
                <LoaderCircle size={16} className="spin" /> 正在读取制作阶段…
              </div>
            ) : stagesQuery.isError ? (
              <div className="writing-state writing-state--error">
                <AlertCircle size={16} /> 无法读取阶段状态：{stagesQuery.error.message}
              </div>
            ) : stages.length ? (
              <ProductionStages stages={stages} />
            ) : (
              <div className="writing-state">项目尚无可展示的制作阶段。</div>
            )}
          </Panel>
          {currentStage && (
            <Panel className="writing-next-step">
              <div>
                <div className="eyebrow">下一步</div>
                <h2>{currentStage.label}</h2>
                <p>{stageDescription(currentStage)}</p>
              </div>
              <Link to={stageRoute(currentStage.stage_key)} className="button button--primary">
                打开阶段 <ArrowRight size={15} />
              </Link>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function selectCurrentStage(stages: StageState[]) {
  return (
    stages.find((stage) =>
      ['needs_review', 'failed', 'blocked', 'stale', 'running'].includes(stage.status),
    ) ??
    stages.find((stage) => stage.status === 'ready') ??
    stages.find((stage) => stage.status === 'not_started')
  );
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

function toneForStatus(status: StageState['status']): 'gold' | 'green' | 'red' | 'neutral' {
  if (status === 'needs_review') return 'gold';
  if (status === 'accepted' || status === 'waived') return 'green';
  if (status === 'failed' || status === 'blocked') return 'red';
  return 'neutral';
}

function stageDescription(stage: StageState) {
  if (stage.status === 'needs_review')
    return '该阶段已产生待审结果。请查看产出，接受或退回并填写修改意见。';
  if (stage.status === 'failed')
    return '该阶段最近一次执行失败。查看任务详情与错误信息后，可修正配置并重试。';
  if (stage.status === 'blocked') return '该阶段受前置条件限制。打开阶段查看缺少的输入或门禁要求。';
  if (stage.status === 'stale') return '上游内容发生变化，该阶段结果需要重新审阅或生成。';
  if (stage.status === 'running') return '该阶段正在执行。可进入工作区查看当前任务和已产出的内容。';
  return '前置阶段满足后即可开始。打开阶段查看输入要求、生成选项与验收规则。';
}
