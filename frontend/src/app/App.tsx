import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Film,
  FolderOpen,
  GalleryVerticalEnd,
  LayoutDashboard,
  Library,
  Plus,
  Settings2,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import { api } from '../lib/api';
import type { Project } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { CreateProjectDialog } from '../components/workspace/CreateProjectDialog';
import { projectKindLabel } from '../components/workspace/projectDimensions';
import { AssetsPage } from '../pages/AssetsPage';
import { DeliveryPage } from '../pages/DeliveryPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SourcePage } from '../pages/SourcePage';
import { WritingPage } from '../pages/WritingPage';
import '../styles/workspace.css';

const CanvasPage = lazy(() =>
  import('../pages/CanvasPage').then(({ CanvasPage: page }) => ({ default: page })),
);
const OriginalLiteraryCharactersWorkspace = lazy(() =>
  import('../pages/OriginalLiteraryCharactersWorkspace').then(
    ({ OriginalLiteraryCharactersWorkspace: page }) => ({ default: page }),
  ),
);
const OriginalNovelDraftWorkspace = lazy(() =>
  import('../pages/OriginalNovelDraftWorkspace').then(({ OriginalNovelDraftWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalContinuityWorkspace = lazy(() =>
  import('../pages/OriginalContinuityWorkspace').then(({ OriginalContinuityWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalAdaptationHandoffWorkspace = lazy(() =>
  import('../pages/OriginalAdaptationHandoffWorkspace').then(
    ({ OriginalAdaptationHandoffWorkspace: page }) => ({ default: page }),
  ),
);
const OriginalAdaptationOutlineWorkspace = lazy(() =>
  import('../pages/OriginalAdaptationOutlineWorkspace').then(
    ({ OriginalAdaptationOutlineWorkspace: page }) => ({ default: page }),
  ),
);
const OriginalScriptWorkspace = lazy(() =>
  import('../pages/OriginalScriptWorkspace').then(({ OriginalScriptWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalShotDesignWorkspace = lazy(() =>
  import('../pages/OriginalShotDesignWorkspace').then(({ OriginalShotDesignWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalKeyframesWorkspace = lazy(() =>
  import('../pages/OriginalKeyframesWorkspace').then(({ OriginalKeyframesWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalVideoWorkspace = lazy(() =>
  import('../pages/OriginalVideoWorkspace').then(({ OriginalVideoWorkspace: page }) => ({
    default: page,
  })),
);
const OriginalVoiceWorkspace = lazy(() =>
  import('../pages/OriginalVoiceWorkspace').then(({ OriginalVoiceWorkspace: page }) => ({
    default: page,
  })),
);

const sections = [
  { to: '/', label: '制片总览', icon: LayoutDashboard },
  { to: '/source', label: '小说与创意', icon: BookOpen },
  { to: '/writing', label: '故事与剧本', icon: Clapperboard },
  { to: '/writing/storyboard', label: '分镜工作台', icon: GalleryVerticalEnd },
  { to: '/canvas', label: '生成流程', icon: Workflow },
  { to: '/assets', label: '素材资产', icon: Library },
  { to: '/delivery', label: '审片交付', icon: Film },
];

function ProjectPickerDialog({
  open,
  projects,
  activeId,
  onClose,
  onSelect,
  onCreate,
}: {
  open: boolean;
  projects: Project[];
  activeId?: string;
  onClose: () => void;
  onSelect: (project: Project) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="切换制作项目"
      description="项目与分集数据相互隔离。"
    >
      <div className="project-picker-list">
        {projects.map((item) => (
          <button
            key={item.id}
            className={`project-picker-row ${item.id === activeId ? 'is-active' : ''}`}
            onClick={() => onSelect(item)}
          >
            <span className="project-select__avatar">{item.name.slice(0, 1)}</span>
            <span>
              <b>{item.name}</b>
              <small>
                {projectKindLabel(item)} · {item.genre || '未设题材'}
              </small>
            </span>
            <Badge tone={item.id === activeId ? 'green' : 'neutral'}>
              {item.id === activeId ? '当前项目' : '打开'}
            </Badge>
          </button>
        ))}
        {!projects.length && (
          <div className="chapter-empty">
            <span>
              <FolderOpen size={19} />
            </span>
            <b>尚未创建服务端项目</b>
            <small>先新建项目，再开始导入或原创写作。</small>
          </div>
        )}
      </div>
      <div className="project-picker-footer">
        <span>列表按最近修改时间排序</span>
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => {
            onClose();
            onCreate();
          }}
        >
          新建项目
        </Button>
      </div>
    </Dialog>
  );
}

function Sidebar({ project, onSelectProject }: { project?: Project; onSelectProject: () => void }) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="brand-stamp">帧</div>
        <div>
          <b>叙帧</b>
          <small>FIELD NOTES FOR STORY</small>
        </div>
        <ChevronDown className="brand-chevron" size={14} />
      </div>
      <button className="project-select" onClick={onSelectProject}>
        <span className="project-select__avatar">{project?.name?.slice(0, 1) ?? '帧'}</span>
        <span className="project-select__copy">
          <b>{project?.name ?? '未选择项目'}</b>
          <small>{project ? projectKindLabel(project) : '选择或创建项目'}</small>
        </span>
        <ChevronDown size={15} />
      </button>
      <nav className="main-nav" aria-label="工作区">
        <div className="nav-caption">制作空间</div>
        {sections.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/' || to === '/writing'}
            className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="episode-list">
        <div className="nav-caption episode-caption">
          <span>项目范围</span>
        </div>
        <div className="episode-row" aria-label="项目制作范围">
          <span className="episode-dot">{project?.target_episodes ?? '—'}</span>
          <span>{project?.creation_mode === 'commercial' ? '商品短片' : '目标集数'}</span>
          <small>
            {project
              ? project.creation_mode === 'commercial'
                ? '单片制作'
                : `${project.episode_seconds ?? '—'} 秒 / 集`
              : '未选择项目'}
          </small>
        </div>
        {project && (
          <Link
            className="episode-more"
            to={project.creation_mode === 'original' ? '/writing/chapters' : '/writing'}
          >
            打开创作阶段 <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
      <div className="sidebar-bottom">
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
        >
          <Settings2 size={17} />
          <span>工作台设置</span>
        </NavLink>
        <div className="workspace-user">
          <div className="user-avatar">M</div>
          <div>
            <b>本地工作区</b>
            <small>{project ? 'API 项目空间' : '未选择项目'}</small>
          </div>
          <SlidersHorizontal size={15} />
        </div>
      </div>
    </aside>
  );
}

function AppShell() {
  const [createOpen, setCreateOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(
    () => localStorage.getItem('xuzhen.active-project') ?? undefined,
  );
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const healthQuery = useQuery({
    queryKey: ['api-health'],
    queryFn: api.health,
    retry: false,
    refetchInterval: 30_000,
  });
  const projects = projectsQuery.data ?? [];
  const project = projects.find((item) => item.id === activeProjectId) ?? projects[0];
  const selectProject = (selected: Project) => {
    setActiveProjectId(selected.id);
    localStorage.setItem('xuzhen.active-project', selected.id);
  };
  const pageTitles = useMemo(
    () => Object.fromEntries(sections.map(({ to, label }) => [to, label])),
    [],
  );
  const location = useLocation();
  const title =
    pageTitles[location.pathname] ??
    (location.pathname.startsWith('/writing')
      ? location.pathname === '/writing/chapters'
        ? '逐章正文'
        : location.pathname === '/writing/continuity'
          ? '连续性审校'
          : location.pathname === '/writing/adaptation'
            ? '逐集改编交接'
            : location.pathname === '/writing/adaptation-outline'
              ? '视频改编大纲'
              : location.pathname === '/writing/script'
                ? '分集剧本'
                : location.pathname === '/writing/storyboard'
                  ? '镜头设计'
                  : location.pathname === '/writing/keyframes'
                    ? '关键帧审阅'
                    : location.pathname === '/writing/video'
                      ? '逐镜视频审片'
                      : location.pathname === '/writing/voice'
                        ? '逐句配音审阅'
                        : location.pathname === '/writing/characters'
                          ? '文学角色圣经'
                          : '故事与剧本'
      : location.pathname === '/settings'
        ? '工作台设置'
        : '叙帧工作台');
  return (
    <div className="app-frame">
      <Sidebar project={project} onSelectProject={() => setProjectPickerOpen(true)} />
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>制作空间</span>
            <span className="breadcrumb-sep">/</span>
            <b>{project?.name ?? '未选择项目'}</b>
            <span className="breadcrumb-sep">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-tools">
            <Badge
              tone={healthQuery.isSuccess ? 'green' : healthQuery.isError ? 'gold' : 'neutral'}
              dot
            >
              {healthQuery.isSuccess ? 'API 已连接' : healthQuery.isError ? 'API 未连接' : '连接中'}
            </Badge>
            <span className="topbar-divider" />
            <ThemeToggle />
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={15} />}
              onClick={() => setCreateOpen(true)}
            >
              新建项目
            </Button>
          </div>
        </header>
        <main className="page-content">
          <Suspense fallback={<div className="page-loading">正在载入流程观察台…</div>}>
            <Routes>
              <Route
                path="/"
                element={
                  <OverviewPage
                    project={project}
                    onCreate={() => setCreateOpen(true)}
                    onSelectProject={selectProject}
                  />
                }
              />
              <Route
                path="/source"
                element={<SourcePage key={project?.id ?? 'demo'} project={project} />}
              />
              <Route path="/writing" element={<WritingPage project={project} />} />
              <Route
                path="/writing/characters"
                element={<OriginalLiteraryCharactersWorkspace project={project} />}
              />
              <Route
                path="/writing/chapters"
                element={<OriginalNovelDraftWorkspace project={project} />}
              />
              <Route
                path="/writing/continuity"
                element={<OriginalContinuityWorkspace project={project} />}
              />
              <Route
                path="/writing/adaptation"
                element={<OriginalAdaptationHandoffWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/adaptation-outline"
                element={<OriginalAdaptationOutlineWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/script"
                element={<OriginalScriptWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/storyboard"
                element={<OriginalShotDesignWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/keyframes"
                element={<OriginalKeyframesWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/video"
                element={<OriginalVideoWorkspace key={project?.id} project={project} />}
              />
              <Route
                path="/writing/voice"
                element={<OriginalVoiceWorkspace key={project?.id} project={project} />}
              />
              <Route path="/storyboard" element={<Navigate to="/writing/storyboard" replace />} />
              <Route path="/canvas" element={<CanvasPage project={project} />} />
              <Route path="/assets" element={<AssetsPage project={project} />} />
              <Route path="/delivery" element={<DeliveryPage project={project} />} />
              <Route path="/settings" element={<SettingsPage project={project} />} />
              <Route
                path="*"
                element={
                  <OverviewPage
                    project={project}
                    onCreate={() => setCreateOpen(true)}
                    onSelectProject={selectProject}
                  />
                }
              />
            </Routes>
          </Suspense>
        </main>
      </div>
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ProjectPickerDialog
        open={projectPickerOpen}
        projects={projects}
        activeId={project?.id}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(selected) => {
          selectProject(selected);
          setProjectPickerOpen(false);
        }}
        onCreate={() => setCreateOpen(true)}
      />
    </div>
  );
}

export function App() {
  return <AppShell />;
}
