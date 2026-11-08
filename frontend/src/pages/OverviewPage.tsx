import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  FolderOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Project, StageState } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';
import { ProductionStages } from '../components/workspace/ProductionStages';
import { stageRoute } from '../components/workspace/stageRoutes';

type Props = {
  project?: Project;
  onCreate: () => void;
  onSelectProject: (project: Project) => void;
};

export function OverviewPage({ project, onCreate, onSelectProject }: Props) {
  const projectId = project?.id;
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(projectId),
  });
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const stages = stagesQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const completedStages = stages.filter((stage) =>
    ['accepted', 'waived'].includes(stage.status),
  ).length;
  const progress = stages.length ? Math.round((completedStages / stages.length) * 100) : 0;
  const reviewStages = stages.filter((stage) =>
    ['needs_review', 'failed', 'blocked', 'stale'].includes(stage.status),
  );
  const currentStage = stages.find((stage) =>
    ['running', 'needs_review', 'ready', 'failed', 'blocked', 'stale'].includes(stage.status),
  );
  const latestJob = jobs[0];
  const recentJobs = jobs;
  const modalityCount = new Set(recentJobs.map((job) => job.modality)).size;
  const projectStatus = getProjectStatus(stages);
  const waiting = stagesQuery.isLoading || jobsQuery.isLoading;

  return (
    <div className="overview-page">
      <PageHeading
        eyebrow="PRODUCTION JOURNAL · 01"
        title="让每个镜头，都有来处。"
        description="从小说证据到画面候选，叙帧把创作决定、来源和版本留在同一条可审阅的生产线上。"
        actions={
          <Button variant="primary" icon={<Plus size={15} />} onClick={onCreate}>
            新建制作项目
          </Button>
        }
      />
      {!project && (
        <div className="demo-banner">
          <span>
            <Sparkles size={16} />
          </span>
          <div>
            <b>欢迎来到叙帧工作台</b>
            <p>创建项目后，项目内容和阶段进度会保存到已连接的 API。</p>
          </div>
          <Button size="sm" onClick={onCreate}>
            创建第一个项目 <ArrowRight size={14} />
          </Button>
        </div>
      )}
      {project && (
        <div className="project-banner">
          <div className="project-monogram">{project.name.slice(0, 1)}</div>
          <div>
            <Badge tone={projectStatus === '待审' ? 'gold' : 'green'} dot>
              {projectStatus}
            </Badge>
            <h2>{project.name}</h2>
            <p>
              {project.genre || '未设题材'} <span>·</span> {project.target_episodes || '集数待定'}{' '}
              集 <span>·</span> {modeLabel(project)}
            </p>
          </div>
          <Link className="banner-link" to="/source">
            进入项目 <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <section className="overview-stats" aria-label="项目制作概况">
        <StatCard
          label="制作进度"
          value={project ? (waiting ? '…' : `${progress}%`) : '—'}
          detail={project ? `${completedStages} / ${stages.length} 阶段已验收` : '选择或创建项目'}
          icon={<Check size={17} />}
          tone="gold"
          progress={project ? progress : undefined}
        />
        <StatCard
          label="待处理阶段"
          value={project ? (stagesQuery.isLoading ? '…' : String(reviewStages.length)) : '—'}
          detail={project ? '待审、失败、阻塞或待返工' : '阶段验收会显示在这里'}
          icon={<FolderOpen size={17} />}
          tone="violet"
        />
        <StatCard
          label="最近生成任务"
          value={project ? (jobsQuery.isLoading ? '…' : String(recentJobs.length)) : '—'}
          detail={
            project ? `最近 20 条记录 · ${modalityCount} 类模型能力` : '文本、图片、视频和语音任务'
          }
          icon={<Sparkles size={17} />}
          tone="blue"
        />
        <StatCard
          label="最近生成活动"
          value={latestJob ? formatRelativeTime(latestJob.created_at) : project ? '暂无' : '—'}
          detail={
            latestJob
              ? `${stageLabel(latestJob.stage_key)} · ${jobStatusLabel(latestJob.status)}`
              : '还没有生成任务'
          }
          icon={<Clock3 size={17} />}
          tone="green"
        />
      </section>
      {project && (stagesQuery.isError || jobsQuery.isError) && (
        <p className="form-error">
          {stagesQuery.isError && `阶段读取失败：${stagesQuery.error.message} `}
          {jobsQuery.isError && `生成任务读取失败：${jobsQuery.error.message}`}
        </p>
      )}
      <div className="overview-grid">
        <Panel className="overview-production">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACTIVE PRODUCTION</div>
              <h3>项目阶段路径</h3>
              <p>阶段状态来自当前项目；审核、失败和阻塞项会显示在右侧队列。</p>
            </div>
            <Link className="plain-icon" aria-label="打开生成流程画布" to="/canvas">
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {project && stagesQuery.isError ? (
            <p className="form-error">无法载入项目阶段：{stagesQuery.error.message}</p>
          ) : project && stages.length ? (
            <>
              <div className="episode-feature">
                <div className="episode-art episode-art--status">
                  <span>{currentStage ? stageStatusLabel(currentStage.status) : '已完成'}</span>
                </div>
                <div className="episode-feature__copy">
                  <Badge tone={currentStage?.status === 'needs_review' ? 'gold' : 'green'}>
                    {currentStage?.label ?? '所有阶段已验收'}
                  </Badge>
                  <h2>{currentStage ? stageStatusLabel(currentStage.status) : '制作流程已完成'}</h2>
                  <p>{currentStage?.expected_output ?? '当前项目的全部阶段均已验收或豁免。'}</p>
                  <div className="episode-meta">
                    <span>
                      <Check size={14} /> 已验收 {completedStages} / {stages.length} 阶段
                    </span>
                    <span>
                      <Clock3 size={14} />{' '}
                      {currentStage
                        ? `第 ${stages.indexOf(currentStage) + 1} / ${stages.length} 阶段`
                        : '全部完成'}
                    </span>
                  </div>
                </div>
              </div>
              <ProductionStages stages={stages} />
            </>
          ) : project ? (
            <p>{stagesQuery.isLoading ? '正在读取项目阶段…' : '当前项目还没有阶段记录。'}</p>
          ) : (
            <p>选择或创建项目后，这里会显示该项目的真实生产阶段和门禁状态。</p>
          )}
          <div className="panel-footer">
            <span>
              <span className="live-dot" />
              AI 提供候选，人工决定是否采纳
            </span>
            {currentStage?.unavailable_reason ? (
              <span
                className="workflow-link-disabled"
                title={currentStage.unavailable_reason}
                aria-disabled="true"
              >
                当前阶段未开放
              </span>
            ) : (
              <Link to={currentStage ? stageRoute(currentStage.stage_key) : '/source'}>
                {currentStage ? `继续${currentStage.label}` : '进入项目'} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </Panel>
        <Panel className="overview-review">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">REVIEW QUEUE</div>
              <h3>需要处理</h3>
              <p>按项目当前的阶段状态排列。</p>
            </div>
            <span className="review-count">{String(reviewStages.length).padStart(2, '0')}</span>
          </div>
          {reviewStages.length ? (
            reviewStages.slice(0, 4).map((stage) => <ReviewRow key={stage.id} stage={stage} />)
          ) : (
            <p className="overview-empty">
              {project ? '当前没有待审或阻塞阶段。' : '选择项目后显示需要你处理的阶段。'}
            </p>
          )}
          {reviewStages.length > 4 && (
            <Link className="review-all" to="/canvas">
              查看其余 {reviewStages.length - 4} 项 <ArrowRight size={14} />
            </Link>
          )}
        </Panel>
      </div>
      <section className="recent-projects">
        <div className="section-head">
          <div>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <h2>最近制作</h2>
          </div>
          <button className="text-link" onClick={onCreate}>
            新建项目 <Plus size={14} />
          </button>
        </div>
        <div className="project-cards">
          {projectsQuery.isLoading ? (
            <p>正在读取项目列表…</p>
          ) : projectsQuery.isError ? (
            <p className="form-error">无法载入项目列表：{projectsQuery.error.message}</p>
          ) : projects.length ? (
            projects
              .slice(0, 2)
              .map((item, index) => (
                <ProjectCard
                  key={item.id}
                  project={item}
                  active={item.id === project?.id}
                  progress={item.id === project?.id ? progress : undefined}
                  hue={index === 0 ? 'umber' : 'teal'}
                  onSelect={() => onSelectProject(item)}
                />
              ))
          ) : (
            <p>还没有项目。创建一个项目后即可开始制作。</p>
          )}
          <button className="project-create-card" onClick={onCreate}>
            <span>
              <Plus size={19} />
            </span>
            <b>开始一个新故事</b>
            <small>已有小说，或从一个创意开始</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: string;
  progress?: number;
}) {
  return (
    <Panel className={`stat-card stat-card--${tone}`}>
      <div className="stat-card__top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {progress !== undefined && (
        <div className="stat-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </Panel>
  );
}

function ReviewRow({ stage }: { stage: StageState }) {
  const tone = stage.status === 'needs_review' ? 'gold' : 'violet';
  const unavailableReason = stage.unavailable_reason;
  if (unavailableReason) {
    return (
      <div className="review-row is-unavailable" title={unavailableReason} aria-disabled="true">
        <div className={`review-thumb review-thumb--${tone}`}>
          {stage.status === 'needs_review' ? <BookOpen size={15} /> : <span>!</span>}
        </div>
        <div className="review-row__copy">
          <b>{stage.label}</b>
          <small>暂未开放 · {stage.expected_output}</small>
        </div>
        <span className="review-row__action">暂不可处理</span>
      </div>
    );
  }
  return (
    <Link className="review-row" to={stageRoute(stage.stage_key)}>
      <div className={`review-thumb review-thumb--${tone}`}>
        {stage.status === 'needs_review' ? <BookOpen size={15} /> : <span>!</span>}
      </div>
      <div className="review-row__copy">
        <b>{stage.label}</b>
        <small>
          {stageStatusLabel(stage.status)} · {stage.expected_output}
        </small>
      </div>
      <span className="review-row__action">
        {stage.status === 'needs_review' ? '审阅' : '处理'} <ArrowRight size={13} />
      </span>
    </Link>
  );
}

function ProjectCard({
  project,
  active,
  progress,
  hue,
  onSelect,
}: {
  project: Project;
  active: boolean;
  progress?: number;
  hue: string;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className="project-card">
      <div className={`project-card__art project-card__art--${hue}`}>
        <div />
        <span>{active ? '当前项目' : modeLabel(project)}</span>
      </div>
      <div className="project-card__copy">
        <b>{project.name}</b>
        <small>{project.genre || modeLabel(project)}</small>
        <div className="project-progress">
          {progress !== undefined && <span style={{ width: `${progress}%` }} />}
        </div>
        <footer>
          <span>{progress === undefined ? '切换项目' : `${progress}% 完成`}</span>
          <span>{formatRelativeTime(project.updated_at)}</span>
        </footer>
      </div>
    </button>
  );
}

function modeLabel(project: Project) {
  if (project.creation_mode === 'original') return '原创小说';
  if (project.creation_mode === 'commercial') return '商品短片';
  return '小说改编';
}

function getProjectStatus(stages: StageState[]) {
  if (stages.some((stage) => stage.status === 'needs_review')) return '待审';
  if (stages.some((stage) => stage.status === 'running')) return '生成中';
  if (stages.length && stages.every((stage) => ['accepted', 'waived'].includes(stage.status)))
    return '已完成';
  return '制作中';
}

function stageLabel(stageKey: string) {
  const labels: Record<string, string> = {
    novelDraft: '小说正文',
    continuity: '连续性审校',
    manuscriptRelease: '原创稿锁版',
    outline: '视频改编大纲',
    script: '分集剧本',
    shotDesign: '分镜设计',
    keyframes: '关键帧',
    video: '逐镜视频',
    voice: '逐句配音',
    post: '后期交付包',
    delivery: '母版交付',
  };
  return labels[stageKey] ?? stageKey;
}

function stageStatusLabel(status: StageState['status']) {
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

function jobStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    running: '生成中',
    succeeded: '已完成',
    failed: '失败',
    stale: '结果过期',
    needs_review: '待审',
  };
  return labels[status] ?? status;
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
