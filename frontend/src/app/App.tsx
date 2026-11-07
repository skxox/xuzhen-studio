import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BookOpen, Check, ChevronDown, Clapperboard, Clock3, Film, FolderOpen,
  GalleryVerticalEnd, LayoutDashboard, Library, Plus, Settings2,
  SlidersHorizontal, Sparkles, Workflow,
} from 'lucide-react';
import { api } from '../lib/api';
import type { CreationMode, Project, ProjectCreateInput } from '../lib/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { AssetsPage } from '../pages/AssetsPage';
import { CanvasPage } from '../pages/CanvasPage';
import { DeliveryPage } from '../pages/DeliveryPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SourcePage } from '../pages/SourcePage';
import { StoryboardPage } from '../pages/StoryboardPage';
import { WritingPage } from '../pages/WritingPage';
import '../styles/workspace.css';

const sections = [
  { to: '/', label: '制片总览', icon: LayoutDashboard },
  { to: '/source', label: '小说与创意', icon: BookOpen },
  { to: '/writing', label: '故事与剧本', icon: Clapperboard },
  { to: '/storyboard', label: '分镜工作台', icon: GalleryVerticalEnd },
  { to: '/canvas', label: '生成流程', icon: Workflow },
  { to: '/assets', label: '素材资产', icon: Library },
  { to: '/delivery', label: '审片交付', icon: Film },
];

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<CreationMode>('adaptation');
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('都市情感');
  const [rights, setRights] = useState<ProjectCreateInput['rights_status']>('unconfirmed');
  const mutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['projects'] }); onClose(); setName(''); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate({ name: name.trim(), creation_mode: mode, genre, target_episodes: 12, episode_seconds: 120, aspect_ratio: '16:9', rights_status: rights });
  };
  return <Dialog open={open} onClose={onClose} title="建立制作项目" description="选择创作入口。后续可调整制作参数与服务路由。"
    footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" type="submit" form="create-project-form" disabled={mutation.isPending}>{mutation.isPending ? '正在创建…' : '创建项目'}</Button></>}>
    <form id="create-project-form" onSubmit={submit} className="form-stack">
      <Field label="项目名称"><TextInput autoFocus required maxLength={200} placeholder="例如：南汀岛的十一分钟" value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <div className="field"><span className="field__label">从哪里开始</span><div className="choice-grid">
        <button type="button" className={`choice-card ${mode === 'adaptation' ? 'is-selected' : ''}`} onClick={() => setMode('adaptation')}>
          <BookOpen size={19} /><strong>已有小说改编</strong><span>导入原文，建立出处与改编映射</span>
        </button>
        <button type="button" className={`choice-card ${mode === 'original' ? 'is-selected' : ''}`} onClick={() => setMode('original')}>
          <Sparkles size={19} /><strong>从创意原创</strong><span>从创意简报逐步写成小说，再交接视频</span>
        </button>
      </div></div>
      <div className="form-row">
        <Field label="题材"><TextInput value={genre} onChange={(event) => setGenre(event.target.value)} /></Field>
        <Field label="原作权利状态" hint="有权状态记录后，才可通过原文阶段门禁。">
          <SelectInput value={rights} onChange={(event) => setRights(event.target.value as ProjectCreateInput['rights_status'])}>
            <option value="unconfirmed">待确认</option><option value="owned">自有版权</option><option value="licensed">已获授权</option><option value="public_domain">公版作品</option><option value="restricted">仅限内部评估</option>
          </SelectInput>
        </Field>
      </div>
      {mutation.isError && <p className="form-error" role="alert">项目创建失败：{mutation.error.message}</p>}
    </form>
  </Dialog>;
}

function ProjectPickerDialog({ open, projects, activeId, onClose, onSelect, onCreate }: {
  open: boolean; projects: Project[]; activeId?: string; onClose: () => void; onSelect: (project: Project) => void; onCreate: () => void;
}) {
  return <Dialog open={open} onClose={onClose} title="切换制作项目" description="项目与分集数据相互隔离。">
    <div className="project-picker-list">{projects.map((item) => <button key={item.id} className={`project-picker-row ${item.id === activeId ? 'is-active' : ''}`} onClick={() => onSelect(item)}>
      <span className="project-select__avatar">{item.name.slice(0, 1)}</span><span><b>{item.name}</b><small>{item.creation_mode === 'original' ? '原创小说' : '小说改编'} · {item.genre || '未设题材'}</small></span><Badge tone={item.id === activeId ? 'green' : 'neutral'}>{item.id === activeId ? '当前项目' : '打开'}</Badge>
    </button>)}{!projects.length && <div className="chapter-empty"><span><FolderOpen size={19}/></span><b>尚未创建服务端项目</b><small>先新建项目，再开始导入或原创写作。</small></div>}</div>
    <div className="project-picker-footer"><span>列表按最近修改时间排序</span><Button variant="primary" icon={<Plus size={14}/>} onClick={() => { onClose(); onCreate(); }}>新建项目</Button></div>
  </Dialog>;
}

function Sidebar({ project, onSelectProject }: { project?: Project; onSelectProject: () => void }) {
  const location = useLocation();
  const isStoryboard = location.pathname === '/storyboard';
  return <aside className="app-sidebar">
    <div className="sidebar-brand"><div className="brand-stamp">帧</div><div><b>叙帧</b><small>FIELD NOTES FOR STORY</small></div><ChevronDown className="brand-chevron" size={14} /></div>
    <button className="project-select" onClick={onSelectProject}><span className="project-select__avatar">{project?.name?.slice(0, 1) ?? '南'}</span><span className="project-select__copy"><b>{project?.name ?? '南汀岛的十一分钟'}</b><small>{project?.creation_mode === 'original' ? '原创小说' : '小说改编'} · 第 1 季</small></span><ChevronDown size={15} /></button>
    <nav className="main-nav" aria-label="工作区">
      <div className="nav-caption">制作空间</div>
      {sections.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{to === '/storyboard' && <i className="nav-current-dot" />}
      </NavLink>)}
    </nav>
    <div className="episode-list">
      <div className="nav-caption episode-caption"><span>本季分集</span><button aria-label="新增分集"><Plus size={14} /></button></div>
      {Array.from({ length: 8 }, (_, index) => <button key={index} className={`episode-row ${isStoryboard && index === 3 ? 'is-selected' : ''}`}>
        <span className="episode-dot">{index < 2 ? <Check size={10} /> : `0${index + 1}`}</span><span>E01-{String(index + 1).padStart(2, '0')}</span><small>{index < 2 ? '已验收' : `${3 + (index % 3)} 镜`}</small>
      </button>)}
      <button className="episode-more">查看全部 18 集 <ChevronDown size={13} /></button>
    </div>
    <div className="sidebar-bottom">
      <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}><Settings2 size={17} /><span>工作台设置</span></NavLink>
      <div className="workspace-user"><div className="user-avatar">M</div><div><b>本地工作区</b><small>{project ? 'API 项目空间' : '仅演示数据'}</small></div><SlidersHorizontal size={15} /></div>
    </div>
  </aside>;
}

function AppShell() {
  const [createOpen, setCreateOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(() => localStorage.getItem('xuzhen.active-project') ?? undefined);
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const healthQuery = useQuery({ queryKey: ['api-health'], queryFn: api.health, retry: false, refetchInterval: 30_000 });
  const projects = projectsQuery.data ?? [];
  const project = projects.find((item) => item.id === activeProjectId) ?? projects[0];
  const pageTitles = useMemo(() => Object.fromEntries(sections.map(({ to, label }) => [to, label])), []);
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? (location.pathname === '/writing' ? '故事与剧本' : location.pathname === '/settings' ? '工作台设置' : '叙帧工作台');
  return <div className="app-frame">
    <Sidebar project={project} onSelectProject={() => setProjectPickerOpen(true)} />
    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumb"><span>制作空间</span><span className="breadcrumb-sep">/</span><b>{project?.name ?? '南汀岛的十一分钟'}</b><span className="breadcrumb-sep">/</span><strong>{title}</strong></div>
        <div className="topbar-tools"><Badge tone={healthQuery.isSuccess ? 'green' : 'neutral'} dot>{healthQuery.isSuccess ? 'API 已连接' : '演示工作区'}</Badge><span className="topbar-divider" /><button className="quiet-action"><Clock3 size={15} />最近保存于 2 分钟前</button><ThemeToggle /><Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>新建项目</Button></div>
      </header>
      <main className="page-content"><Routes>
        <Route path="/" element={<OverviewPage project={project} onCreate={() => setCreateOpen(true)} />} />
        <Route path="/source" element={<SourcePage key={project?.id ?? 'demo'} project={project} />} />
        <Route path="/writing" element={<WritingPage />} />
        <Route path="/storyboard" element={<StoryboardPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/assets" element={<AssetsPage project={project} />} />
        <Route path="/delivery" element={<DeliveryPage />} />
        <Route path="/settings" element={<SettingsPage project={project} />} />
        <Route path="*" element={<OverviewPage project={project} onCreate={() => setCreateOpen(true)} />} />
      </Routes></main>
    </div>
    <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    <ProjectPickerDialog open={projectPickerOpen} projects={projects} activeId={project?.id} onClose={() => setProjectPickerOpen(false)} onSelect={(selected) => { setActiveProjectId(selected.id); localStorage.setItem('xuzhen.active-project', selected.id); setProjectPickerOpen(false); }} onCreate={() => setCreateOpen(true)} />
  </div>;
}

export function App() {
  return <AppShell />;
}
