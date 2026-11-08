import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Clock3,
  Film,
  FolderOpen,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';
import { ProductionStages } from '../components/workspace/ProductionStages';

export function OverviewPage({ project, onCreate }: { project?: Project; onCreate: () => void }) {
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
            <p>当前展示的是本地演示工作区。创建项目后，项目与原文将保存到已连接的 API。</p>
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
            <Badge tone="green" dot>
              制作中
            </Badge>
            <h2>{project.name}</h2>
            <p>
              {project.genre || '未设题材'} <span>·</span> {project.target_episodes || 12} 集{' '}
              <span>·</span>{' '}
              {project.creation_mode === 'original'
                ? '原创小说'
                : project.creation_mode === 'commercial'
                  ? '商品短片'
                  : '小说改编'}
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
          value="42%"
          detail="3 / 8 阶段已验收"
          icon={<Check size={17} />}
          tone="gold"
          progress={42}
        />
        <StatCard
          label="待审候选"
          value="12"
          detail="4 个镜头 · 8 张关键帧"
          icon={<FolderOpen size={17} />}
          tone="violet"
        />
        <StatCard
          label="本周生成"
          value="38"
          detail="跨 3 类模型服务"
          icon={<Sparkles size={17} />}
          tone="blue"
        />
        <StatCard
          label="最近活动"
          value="14:32"
          detail="分镜版本 v03 已保存"
          icon={<Clock3 size={17} />}
          tone="green"
        />
      </section>
      <div className="overview-grid">
        <Panel className="overview-production">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">ACTIVE PRODUCTION</div>
              <h3>本集制作路径</h3>
              <p>每一步都可审阅、返工或带着风险说明豁免。</p>
            </div>
            <button className="plain-icon" aria-label="制作阶段选项">
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className="episode-feature">
            <div className="episode-art">
              <div className="episode-art__sun" />
              <div className="episode-art__window" />
              <div className="episode-art__person" />
              <span>01:24</span>
            </div>
            <div className="episode-feature__copy">
              <Badge tone="gold">EPISODE 04</Badge>
              <h2>空白的十一分钟</h2>
              <p>剧本 v04 已确认；分镜正在核对电台方位与时间线。</p>
              <div className="episode-meta">
                <span>
                  <Film size={14} /> 4 个镜头
                </span>
                <span>
                  <Clock3 size={14} /> 预计 42 秒
                </span>
              </div>
            </div>
          </div>
          <ProductionStages />
          <div className="panel-footer">
            <span>
              <span className="live-dot" />
              AI 生成候选，人工决定是否采纳
            </span>
            <Link to="/storyboard">
              继续分镜 <ArrowRight size={14} />
            </Link>
          </div>
        </Panel>
        <Panel className="overview-review">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">REVIEW QUEUE</div>
              <h3>等你拍板</h3>
              <p>优先处理会阻塞下游的决定。</p>
            </div>
            <span className="review-count">03</span>
          </div>
          <ReviewRow
            type="finding"
            title="两份潮位记录相差 11 分钟"
            meta="时间线 finding · 第 6 章 → 第 7 章"
            action="复核"
            tone="gold"
          />
          <ReviewRow
            type="frame"
            title="林澄 · 防风外套造型"
            meta="关键帧候选 · 3 个版本"
            action="比较"
            tone="violet"
          />
          <ReviewRow
            type="script"
            title="第 4 集剧本结构"
            meta="分集剧本 · 版本 v02"
            action="审阅"
            tone="blue"
          />
          <Link className="review-all" to="/storyboard">
            查看全部待审 <ArrowRight size={14} />
          </Link>
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
          <ProjectCard
            title={project?.name || '南汀岛的十一分钟'}
            subtitle="小说改编 · 海岛悬疑"
            progress={42}
            hue="umber"
          />
          <ProjectCard title="灯塔以北" subtitle="原创小说 · 海岸群像" progress={18} hue="teal" />
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

function ReviewRow({
  type,
  title,
  meta,
  action,
  tone,
}: {
  type: string;
  title: string;
  meta: string;
  action: string;
  tone: string;
}) {
  return (
    <div className="review-row">
      <div className={`review-thumb review-thumb--${tone}`}>
        {type === 'finding' ? (
          <span>!</span>
        ) : type === 'frame' ? (
          <span>◈</span>
        ) : (
          <BookOpen size={15} />
        )}
      </div>
      <div className="review-row__copy">
        <b>{title}</b>
        <small>{meta}</small>
      </div>
      <button>
        {action}
        <ArrowRight size={13} />
      </button>
    </div>
  );
}

function ProjectCard({
  title,
  subtitle,
  progress,
  hue,
}: {
  title: string;
  subtitle: string;
  progress: number;
  hue: string;
}) {
  return (
    <Link to="/source" className="project-card">
      <div className={`project-card__art project-card__art--${hue}`}>
        <div />
        <span>{subtitle.split(' · ')[0]}</span>
      </div>
      <div className="project-card__copy">
        <b>{title}</b>
        <small>{subtitle}</small>
        <div className="project-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <footer>
          <span>{progress}% 完成</span>
          <span>刚刚更新</span>
        </footer>
      </div>
    </Link>
  );
}
