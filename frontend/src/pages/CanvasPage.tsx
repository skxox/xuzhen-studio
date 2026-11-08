import { useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  RefreshCw,
  Workflow,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { GenerationJobSummary, Project, StageState } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';

type StageNodeData = { stage: StageState; job?: GenerationJobSummary };
type StageFlowNode = Node<StageNodeData, 'stage'>;

const nodeTypes = { stage: StageNodeCard };

const stageRoutes: Record<string, string> = {
  commercialBrief: '/source',
  creativeBrief: '/source',
  storyBible: '/source',
  novelOutline: '/writing',
  literaryCharacters: '/assets',
  novelDraft: '/writing',
  continuity: '/writing/continuity',
  manuscriptRelease: '/writing/continuity',
  source: '/source',
  outline: '/writing',
  characters: '/assets',
  art: '/assets',
  script: '/writing',
  shotDesign: '/writing/storyboard',
  keyframes: '/writing/keyframes',
  video: '/writing/video',
  post: '/delivery',
  delivery: '/delivery',
};

export function CanvasPage({ project }: { project?: Project }) {
  const [selectedKey, setSelectedKey] = useState('');
  const stagesQuery = useQuery({
    queryKey: ['stages', project?.id],
    queryFn: () => api.stages(project!.id),
    enabled: Boolean(project?.id),
    retry: false,
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', project?.id],
    queryFn: () => api.jobs(project!.id),
    enabled: Boolean(project?.id),
    retry: false,
  });
  const graph = useMemo(
    () => buildGraph(stagesQuery.data ?? [], jobsQuery.data ?? []),
    [stagesQuery.data, jobsQuery.data],
  );
  const selected =
    graph.stages.find((stage) => stage.stage_key === selectedKey) ??
    graph.stages.find((stage) => stage.status === 'needs_review') ??
    graph.stages.find((stage) => stage.status === 'running') ??
    graph.stages[0];
  const selectedJob = selected ? graph.jobsByStage.get(selected.stage_key) : undefined;
  const waitingCount = graph.stages.filter((stage) => stage.status === 'needs_review').length;
  const runningCount = graph.stages.filter((stage) => stage.status === 'running').length;
  const refresh = () => {
    void stagesQuery.refetch();
    void jobsQuery.refetch();
  };

  return (
    <div className="canvas-page">
      <PageHeading
        eyebrow="PRODUCTION GRAPH · OBSERVABILITY"
        title="制作流程运行观察台。"
        description="流程节点和依赖来自服务端阶段定义；这里观察运行与审阅状态，不要求人工搭图。选择节点可查看输入快照、参数、审阅决定和阶段产物记录。"
        actions={
          <>
            <Badge tone={waitingCount ? 'gold' : runningCount ? 'blue' : 'green'} dot>
              {waitingCount
                ? `${waitingCount} 项待人工审阅`
                : runningCount
                  ? `${runningCount} 个阶段执行中`
                  : '阶段状态已同步'}
            </Badge>
            <Button
              icon={<RefreshCw size={14} />}
              onClick={refresh}
              disabled={!project || stagesQuery.isFetching || jobsQuery.isFetching}
            >
              {stagesQuery.isFetching || jobsQuery.isFetching ? '同步中…' : '同步状态'}
            </Button>
          </>
        }
      />
      <div className="canvas-toolbar">
        <div>
          <span>
            <span className="live-dot" />
            服务端阶段图
          </span>
          <span>·</span>
          <span>{project?.name ?? '未选择项目'}</span>
          <span>·</span>
          <span>{graph.stages.length} 个生产阶段</span>
          <span>·</span>
          <span>{graph.jobs.length} 个生成任务</span>
        </div>
        <div>
          <span className="canvas-readonly">
            <Workflow size={14} />
            只读执行视图 · 依赖由工作流定义维护
          </span>
        </div>
      </div>
      {!project ? (
        <Panel className="canvas-empty">
          <Workflow size={22} />
          <b>先选择一个制作项目</b>
          <span>项目创建后，画布会按小说创作或小说改编流程读取阶段与依赖。</span>
          <Link to="/">
            返回制片总览 <ArrowUpRight size={13} />
          </Link>
        </Panel>
      ) : stagesQuery.isLoading ? (
        <Panel className="canvas-empty">
          <span className="live-dot" />
          <b>正在读取项目工作流…</b>
        </Panel>
      ) : stagesQuery.isError ? (
        <Panel className="canvas-empty canvas-empty--error">
          <AlertCircle size={20} />
          <b>工作流状态读取失败</b>
          <span>{stagesQuery.error.message}</span>
          <Button onClick={refresh}>重试</Button>
        </Panel>
      ) : !graph.stages.length ? (
        <Panel className="canvas-empty">
          <b>项目还没有阶段定义</b>
          <span>请刷新项目或检查后端工作流初始化状态。</span>
        </Panel>
      ) : (
        <>
          {jobsQuery.isError && (
            <div className="inline-notice" role="status">
              生成任务列表暂不可用：{jobsQuery.error.message}。节点仍显示已读取的阶段状态。
            </div>
          )}
          <div className="canvas-layout">
            <Panel className="graph-panel">
              <div className="flow-canvas" aria-label="制作流程节点画布">
                <ReactFlow<StageFlowNode, Edge>
                  nodes={graph.nodes}
                  edges={graph.edges}
                  nodeTypes={nodeTypes}
                  onNodeClick={(_, node) => setSelectedKey(node.data.stage.stage_key)}
                  fitView
                  fitViewOptions={{ padding: 0.16, minZoom: 0.3, maxZoom: 0.9 }}
                  minZoom={0.22}
                  maxZoom={1.3}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  panOnScroll
                  zoomOnDoubleClick={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={19}
                    size={1}
                    color="var(--canvas-dot)"
                  />
                  <Controls position="bottom-left" showInteractive={false} />
                  <MiniMap
                    position="bottom-right"
                    pannable
                    zoomable
                    nodeColor={(node) => statusColor((node.data as StageNodeData).stage.status)}
                  />
                </ReactFlow>
                <div className="flow-legend">
                  <span>
                    <i className="is-accepted" />
                    已验收
                  </span>
                  <span>
                    <i className="is-running" />
                    执行中
                  </span>
                  <span>
                    <i className="is-review" />
                    等待人工审阅
                  </span>
                  <span>
                    <i className="is-locked" />
                    未解锁
                  </span>
                </div>
              </div>
            </Panel>
            <StageInspector stage={selected} job={selectedJob} project={project} />
          </div>
        </>
      )}
    </div>
  );
}

function StageNodeCard({ data, selected }: NodeProps<StageFlowNode>) {
  const { stage, job } = data;
  const status = statusLabel(stage.status);
  return (
    <div className={`stage-node stage-node--${stage.status} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="stage-node__handle" />
      <div className="stage-node__top">
        <span className="stage-node__status">
          {stage.status === 'accepted' ? (
            <Check size={13} />
          ) : stage.status === 'needs_review' ? (
            <AlertCircle size={13} />
          ) : stage.status === 'running' ? (
            <Clock3 size={13} />
          ) : (
            <Circle size={11} />
          )}
        </span>
        <span className="stage-node__key">{stage.stage_key}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <b>{stage.label}</b>
      <span className="stage-node__role">{stage.responsibility}</span>
      <div className="stage-node__bottom">
        <span>
          v{String(stage.version).padStart(2, '0')}
          {stage.stale ? ' · 已过期' : ''}
        </span>
        <span>{job ? `任务 ${job.status}` : stage.expected_output}</span>
      </div>
      <Handle type="source" position={Position.Right} className="stage-node__handle" />
    </div>
  );
}

function StageInspector({
  stage,
  job,
  project,
}: {
  stage?: StageState;
  job?: GenerationJobSummary;
  project?: Project;
}) {
  if (!stage)
    return (
      <aside className="graph-inspector">
        <Panel className="stage-inspector">
          <b>选择一个阶段节点</b>
          <span>阶段详情将在此处显示。</span>
        </Panel>
      </aside>
    );
  const route =
    stage.stage_key === 'keyframes' && project?.creation_mode === 'original'
      ? '/writing/keyframes'
      : stage.stage_key === 'shotDesign' && project?.creation_mode === 'original'
        ? '/writing/storyboard'
        : stage.stage_key === 'source' && project?.creation_mode === 'original'
          ? '/writing/adaptation'
          : stage.stage_key === 'outline' && project?.creation_mode === 'original'
            ? '/writing/adaptation-outline'
            : ['characters', 'art', 'script'].includes(stage.stage_key) &&
                project?.creation_mode === 'original'
              ? '/writing/script'
              : (stageRoutes[stage.stage_key] ?? '/');
  const status = statusLabel(stage.status);
  const params = job?.input_snapshot.parameters;
  return (
    <aside className="graph-inspector">
      <Panel className="stage-inspector">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">
              {stage.stage_key} · VERSION {String(stage.version).padStart(2, '0')}
            </div>
            <h3>{stage.label}</h3>
            <p>{stage.responsibility}</p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        {stage.status === 'needs_review' && (
          <div className="stage-review-alert">
            <AlertCircle size={15} />
            <span>
              <b>等待人工审阅</b>
              <small>下游阶段保持锁定，需先在阶段工作区确认或退回候选。</small>
            </span>
          </div>
        )}
        <section className="inspector-block">
          <h4>节点职责与产物契约</h4>
          <p>{stage.expected_output}</p>
        </section>
        <section className="inspector-block">
          <h4>依赖阶段</h4>
          {stage.depends_on.length ? (
            <div className="dependency-list">
              {stage.depends_on.map((key) => (
                <span key={key}>{graphLabel(key)}</span>
              ))}
            </div>
          ) : (
            <p>无上游依赖</p>
          )}
        </section>
        <section className="inspector-block">
          <h4>最近运行输入与参数</h4>
          {job ? (
            <>
              <div className="job-meta">
                <Badge tone={job.status === 'blocked' || job.status === 'failed' ? 'red' : 'blue'}>
                  {job.modality} · {job.status}
                </Badge>
                <small>{new Date(job.created_at).toLocaleString()}</small>
              </div>
              <pre className="snapshot-json">{formatJson(job.input_snapshot)}</pre>
              <details className="snapshot-details">
                <summary>Provider 快照</summary>
                <pre className="snapshot-json">{formatJson(job.provider_snapshot)}</pre>
              </details>
            </>
          ) : (
            <p>本阶段尚无生成任务记录；执行输入与参数会在任务提交后显示。</p>
          )}
          {params !== undefined && <span className="snapshot-caption">参数包含在输入快照中</span>}
        </section>
        <section className="inspector-block">
          <h4>输出 / 审阅决定</h4>
          {job?.output?.content ? (
            <>
              <pre className="generation-output">{job.output.content}</pre>
              {job.output.metadata && (
                <details className="snapshot-details">
                  <summary>用量信息</summary>
                  <pre className="snapshot-json">{formatJson(job.output.metadata)}</pre>
                </details>
              )}
            </>
          ) : stage.decision && Object.keys(stage.decision).length ? (
            <pre className="snapshot-json">{formatJson(stage.decision)}</pre>
          ) : (
            <p>暂无持久化输出候选。执行任务后，生成内容会在此处显示。</p>
          )}
          {job?.error && Object.keys(job.error).length > 0 && (
            <div className="job-error">
              <b>最近任务错误</b>
              <pre>{formatJson(job.error)}</pre>
            </div>
          )}
        </section>
        <div className="stage-inspector__footer">
          <Link className="button button--sm" to={route}>
            打开阶段工作区 <ArrowUpRight size={13} />
          </Link>
          <span>画布只读；节点编辑在对应阶段页面完成。</span>
        </div>
      </Panel>
    </aside>
  );
}

function buildGraph(stages: StageState[], jobs: GenerationJobSummary[]) {
  const jobsByStage = new Map<string, GenerationJobSummary>();
  for (const job of jobs) if (!jobsByStage.has(job.stage_key)) jobsByStage.set(job.stage_key, job);
  const ranks = new Map(stages.map((stage) => [stage.stage_key, 0]));
  for (let iteration = 0; iteration < stages.length; iteration += 1) {
    for (const stage of stages) {
      const parents = stage.depends_on
        .map((key) => ranks.get(key))
        .filter((rank): rank is number => rank !== undefined);
      if (parents.length) ranks.set(stage.stage_key, Math.max(...parents) + 1);
    }
  }
  const columns = new Map<number, StageState[]>();
  for (const stage of stages) {
    const rank = ranks.get(stage.stage_key) ?? 0;
    columns.set(rank, [...(columns.get(rank) ?? []), stage]);
  }
  const nodes: StageFlowNode[] = stages.map((stage) => {
    const rank = ranks.get(stage.stage_key) ?? 0;
    const column = columns.get(rank) ?? [stage];
    const row = column.findIndex((item) => item.stage_key === stage.stage_key);
    return {
      id: stage.stage_key,
      type: 'stage',
      position: { x: rank * 290, y: row * 190 },
      data: { stage, job: jobsByStage.get(stage.stage_key) },
    };
  });
  const edges: Edge[] = stages.flatMap((stage) =>
    stage.depends_on
      .filter((dependency) => stages.some((item) => item.stage_key === dependency))
      .map((dependency) => ({
        id: `${dependency}--${stage.stage_key}`,
        source: dependency,
        target: stage.stage_key,
        type: 'smoothstep',
        animated: stage.status === 'running' || stage.status === 'needs_review',
        className: stage.status === 'needs_review' ? 'flow-edge--review' : undefined,
      })),
  );
  return { stages, jobs, jobsByStage, nodes, edges };
}

function statusLabel(status: StageState['status']): {
  label: string;
  tone: 'green' | 'blue' | 'gold' | 'red' | 'neutral';
} {
  const values: Record<
    StageState['status'],
    { label: string; tone: 'green' | 'blue' | 'gold' | 'red' | 'neutral' }
  > = {
    not_started: { label: '未解锁', tone: 'neutral' },
    ready: { label: '可开始', tone: 'blue' },
    running: { label: '执行中', tone: 'blue' },
    needs_review: { label: '待审阅', tone: 'gold' },
    accepted: { label: '已验收', tone: 'green' },
    waived: { label: '已豁免', tone: 'gold' },
    blocked: { label: '已阻塞', tone: 'red' },
    stale: { label: '已过期', tone: 'gold' },
    failed: { label: '失败', tone: 'red' },
  };
  return values[status];
}

function statusColor(status: StageState['status']): string {
  if (status === 'accepted') return 'var(--green)';
  if (status === 'needs_review' || status === 'stale' || status === 'waived')
    return 'var(--accent)';
  if (status === 'running' || status === 'ready') return 'var(--blue)';
  if (status === 'blocked' || status === 'failed') return 'var(--red)';
  return 'var(--subtle)';
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function graphLabel(stageKey: string): string {
  return stageKey.replace(/([A-Z])/g, ' $1');
}
