import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  FolderInput,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { Chapter, Project } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { Dialog } from '../components/ui/Dialog';
import { CommercialBriefWorkspace } from '../components/workspace/CommercialBriefWorkspace';
import { CreativeBriefWorkspace } from '../components/workspace/CreativeBriefWorkspace';

export function SourcePage({ project }: { project?: Project }) {
  const [entry, setEntry] = useState<'source' | 'brief'>(
    project?.creation_mode === 'original' ? 'brief' : 'source',
  );
  const [toast, setToast] = useState('');
  const [rightsDraft, setRightsDraft] = useState<Project['rights_status']>(
    project?.rights_status ?? 'unconfirmed',
  );
  const [selectedChapter, setSelectedChapter] = useState<Chapter>();
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterBody, setChapterBody] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const chapters = useQuery({
    queryKey: ['chapters', project?.id],
    queryFn: () => api.chapters(project!.id),
    enabled: Boolean(project?.id),
  });
  const chapterVersions = useQuery({
    queryKey: ['chapter-versions', project?.id, selectedChapter?.id],
    queryFn: () => api.chapterVersions(project!.id, selectedChapter!.id),
    enabled: Boolean(project?.id && selectedChapter),
  });
  const stages = useQuery({
    queryKey: ['stages', project?.id],
    queryFn: () => api.stages(project!.id),
    enabled: Boolean(project?.id),
  });
  const sourceStage = stages.data?.find((item) => item.stage_key === 'source');
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadChapters(project!.id, file),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chapters', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
      ]);
      setToast(`已解析 ${result.chapters.length} 个章节。请抽查原文并确认权利状态后验收。`);
    },
  });
  const saveRights = useMutation({
    mutationFn: () => api.updateProjectRights(project!.id, rightsDraft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setToast('项目权利状态已保存。');
    },
  });
  const decideSource = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project!.id,
        'source',
        action,
        action === 'reject' ? returnReason.trim() : undefined,
      ),
    onSuccess: async (result) => {
      setReturnReason('');
      await queryClient.invalidateQueries({ queryKey: ['stages', project?.id] });
      setToast(
        result.status === 'accepted'
          ? '原文来源已验收；视频改编大纲阶段已解锁。'
          : '原文已退回；重新导入修订内容后可再次审阅。',
      );
    },
  });
  const reviseChapter = useMutation({
    mutationFn: () =>
      api.reviseChapter(project!.id, selectedChapter!.id, {
        title: chapterTitle.trim(),
        body: chapterBody.trim(),
      }),
    onSuccess: async (revision) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chapters', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
      ]);
      setSelectedChapter(undefined);
      setToast(`第 ${revision.ordinal} 章已保存为 v${revision.version}；来源阶段需要重新验收。`);
    },
  });
  const restoreChapter = useMutation({
    mutationFn: (version: number) =>
      api.restoreChapterVersion(project!.id, selectedChapter!.id, version),
    onSuccess: async (revision) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['chapters', project?.id] }),
        queryClient.invalidateQueries({ queryKey: ['stages', project?.id] }),
      ]);
      setSelectedChapter(undefined);
      setToast(`已从历史版本恢复，并另存为 v${revision.version}；来源阶段需要重新验收。`);
    },
  });
  const openChapter = (chapter: Chapter) => {
    setSelectedChapter(chapter);
    setChapterTitle(chapter.title);
    setChapterBody(chapter.body);
  };
  const original = project?.creation_mode === 'original';
  if (project?.creation_mode === 'commercial')
    return <CommercialBriefWorkspace project={project} />;
  return (
    <div className="source-page">
      <PageHeading
        eyebrow={original ? 'ORIGINAL STORY' : 'SOURCE MANUSCRIPT'}
        title={original ? '从一句想法，写出一部小说。' : '先读懂原文，再开始改编。'}
        description={
          original
            ? '创意简报、故事圣经、章节计划与正文分批创作。每个版本可审阅，锁定后再交接视频制作。'
            : '导入已有作品，确认章节结构与权利，再建立带原文出处的改编依据。'
        }
        actions={
          <Badge tone={project?.rights_status === 'unconfirmed' ? 'gold' : 'green'} dot>
            {project?.rights_status === 'unconfirmed' ? '权利状态待确认' : '权利信息已记录'}
          </Badge>
        }
      />
      <div className="source-tabs">
        <button
          className={entry === 'source' ? 'is-active' : ''}
          onClick={() => setEntry('source')}
        >
          <FolderInput size={15} />
          已有小说改编
        </button>
        <button className={entry === 'brief' ? 'is-active' : ''} onClick={() => setEntry('brief')}>
          <Sparkles size={15} />
          从创意原创
        </button>
      </div>
      {!project && (
        <div className="inline-notice">
          <BookOpen size={17} />
          <span>当前没有连接的服务端项目。创建项目后，章节导入与创作简报会保存到 API。</span>
        </div>
      )}
      {entry === 'source' ? (
        <div className="source-grid">
          <Panel className="source-import-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">01 · IMPORT</div>
                <h3>导入作品原文</h3>
                <p>当前后端支持 UTF-8 编码的 TXT / Markdown。原文会保存在本地 API 数据库。</p>
              </div>
              <Badge tone="blue">TXT · MD</Badge>
            </div>
            <button
              className="drop-zone"
              onClick={() => input.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) upload.mutate(file);
              }}
            >
              <span className="drop-zone__icon">
                <UploadCloud size={22} />
              </span>
              <b>拖放小说文件到这里</b>
              <small>或从电脑中选择 · 单个文件不超过 40 MB</small>
              <span className="drop-zone__cta">
                选择文件 <ChevronRight size={14} />
              </span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = '';
              }}
            />
            {upload.isPending && (
              <div className="upload-progress">
                <span />
                <small>正在上传并解析章节…</small>
              </div>
            )}
            {upload.isError && (
              <p role="alert" className="form-error">
                导入失败：{upload.error.message}
              </p>
            )}
            <div className="import-rules">
              <div>
                <Check size={14} />
                自动识别章节标题
              </div>
              <div>
                <Check size={14} />
                记录文件名与内容哈希
              </div>
              <div>
                <Check size={14} />
                进入原文审阅门禁
              </div>
            </div>
          </Panel>
          <Panel className="rights-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">RIGHTS & DATA USE</div>
                <h3>权利与模型使用范围</h3>
                <p>记录原作使用依据；云端模型处理仍需单独授权。</p>
              </div>
              <LockKeyhole size={18} />
            </div>
            <div className="rights-callout">
              <ShieldCheck size={19} />
              <span>
                <b>当前项目权利：{rightsLabel(project?.rights_status)}</b>
                <small>原文阶段验收前必须记录权利状态；限制使用的作品只能在授权范围内推进。</small>
              </span>
            </div>
            <Field label="原作权利状态">
              <SelectInput
                value={rightsDraft}
                disabled={sourceStage?.status === 'needs_review'}
                onChange={(event) => setRightsDraft(event.target.value as Project['rights_status'])}
              >
                <option value="unconfirmed">待确认</option>
                <option value="owned">自有版权</option>
                <option value="licensed">已获授权</option>
                <option value="public_domain">公版作品</option>
                <option value="restricted">仅限内部评估</option>
              </SelectInput>
            </Field>
            <Button
              disabled={
                !project ||
                saveRights.isPending ||
                rightsDraft === project?.rights_status ||
                sourceStage?.status === 'needs_review'
              }
              onClick={() => saveRights.mutate()}
            >
              {saveRights.isPending ? '正在保存…' : '保存权利状态'}
            </Button>
            {saveRights.isError && (
              <p className="form-error" role="alert">
                权利状态保存失败：{saveRights.error.message}
              </p>
            )}
            <div className="rights-list">
              <div>
                <span>原文进入模型服务</span>
                <Badge tone="gold">默认不授权</Badge>
              </div>
              <div>
                <span>按服务逐个选择文本 / 图片 / 视频</span>
                <Badge>需单独设置</Badge>
              </div>
              <div>
                <span>生成任务保存授权和服务快照</span>
                <Badge>后端待接入</Badge>
              </div>
            </div>
          </Panel>
          <Panel className="chapter-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">CHAPTER MAP</div>
                <h3>
                  章节结构 <span className="heading-muted">{chapters.data?.length ?? 0} 章</span>
                </h3>
                <p>检查章节顺序、重复内容与分批导入结果。</p>
              </div>
              <button
                className="plain-icon"
                aria-label="添加章节"
                onClick={() => input.current?.click()}
              >
                <Plus size={17} />
              </button>
            </div>
            {chapters.isLoading ? (
              <div className="chapter-empty">正在读取章节…</div>
            ) : chapters.data?.length ? (
              <div className="chapter-list">
                {chapters.data.map((chapter) => (
                  <div className="chapter-row" key={chapter.id}>
                    <span className="chapter-index">
                      {String(chapter.ordinal).padStart(2, '0')}
                    </span>
                    <FileText size={16} />
                    <div>
                      <b>{chapter.title}</b>
                      <small>
                        {chapter.body.length.toLocaleString()} 字 · v{chapter.version} ·{' '}
                        {chapter.source_name || '粘贴导入'}
                      </small>
                    </div>
                    <Badge tone={sourceStage?.status === 'accepted' ? 'green' : 'gold'}>
                      {sourceStage?.status === 'accepted' ? '已验收' : '待审阅'}
                    </Badge>
                    <button className="text-link" onClick={() => openChapter(chapter)}>
                      查看 / 修订
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="chapter-empty">
                <span>
                  <BookOpen size={19} />
                </span>
                <b>还没有导入章节</b>
                <small>导入作品后，章节解析结果会出现在这里。</small>
              </div>
            )}
            {sourceStage?.status === 'needs_review' && (
              <div className="source-review-box">
                <div>
                  <b>原文来源等待审核</b>
                  <small>逐章抽查导入结果，确认权利状态已记录，再验收并解锁改编大纲。</small>
                </div>
                <Field label="退回原因">
                  <TextInput
                    value={returnReason}
                    onChange={(event) => setReturnReason(event.target.value)}
                    maxLength={1000}
                    placeholder="例如：章节缺失，需重新导入"
                  />
                </Field>
                <div className="brief-actions">
                  <Button
                    variant="danger"
                    disabled={!returnReason.trim() || decideSource.isPending}
                    onClick={() => decideSource.mutate('reject')}
                  >
                    退回修订
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      !chapters.data?.length ||
                      project?.rights_status === 'unconfirmed' ||
                      decideSource.isPending
                    }
                    title={
                      project?.rights_status === 'unconfirmed' ? '请先保存原作权利状态' : undefined
                    }
                    onClick={() => decideSource.mutate('accept')}
                  >
                    验收原文并解锁下一阶段
                  </Button>
                </div>
                {decideSource.isError && (
                  <p className="form-error" role="alert">
                    审核操作失败：{decideSource.error.message}
                  </p>
                )}
              </div>
            )}
            {toast && (
              <div className="inline-success" role="status">
                <Check size={14} />
                {toast}
                <button onClick={() => setToast('')} aria-label="关闭">
                  ×
                </button>
              </div>
            )}
          </Panel>
          <Panel className="source-analysis-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">ANALYSIS QUEUE</div>
                <h3>AI 原文分析</h3>
                <p>抽取结果先形成带出处候选，不会直接进入已确认设定。</p>
              </div>
              <Badge tone="neutral">等待原文确认</Badge>
            </div>
            <div className="analysis-flow">
              <AnalysisStep
                number="01"
                title="章节结构与段落索引"
                detail="识别章 / 节标题，建立可回跳原文位置"
              />
              <AnalysisStep
                number="02"
                title="人物、关系与状态"
                detail="姓名与别名归并；区分原文事实和模型推断"
              />
              <AnalysisStep
                number="03"
                title="事件、对白与伏笔"
                detail="提取时间线、信息揭露顺序和场景道具"
              />
              <AnalysisStep
                number="04"
                title="确认分析候选"
                detail="逐条审阅出处后，才允许生成改编大纲"
              />
            </div>
            <Button
              variant="primary"
              disabled={!project || !chapters.data?.length}
              icon={<Sparkles size={15} />}
              onClick={() =>
                setToast('原文分析流程尚未接入任务编排；当前文本服务仅接入原创故事圣经生成。')
              }
            >
              分析原文 <ChevronRight size={14} />
            </Button>
          </Panel>
        </div>
      ) : (
        <CreativeBriefWorkspace project={project} onSave={setToast} />
      )}
      <Dialog
        open={Boolean(selectedChapter)}
        onClose={() => setSelectedChapter(undefined)}
        title={selectedChapter ? `修订第 ${selectedChapter.ordinal} 章` : '章节原文'}
        description={
          selectedChapter
            ? `当前 v${selectedChapter.version} · SHA-256 ${selectedChapter.content_hash.slice(0, 16)}…；保存后创建新版本并重新进入来源审核。`
            : undefined
        }
        footer={
          <>
            <Button onClick={() => setSelectedChapter(undefined)}>取消</Button>
            <Button
              variant="primary"
              disabled={
                !chapterTitle.trim() ||
                !chapterBody.trim() ||
                reviseChapter.isPending ||
                restoreChapter.isPending ||
                (chapterTitle === selectedChapter?.title && chapterBody === selectedChapter?.body)
              }
              onClick={() => reviseChapter.mutate()}
            >
              {reviseChapter.isPending
                ? '保存中…'
                : `保存为 v${(selectedChapter?.version ?? 0) + 1}`}
            </Button>
          </>
        }
      >
        {selectedChapter && (
          <div className="chapter-edit-form">
            <Field label="章节标题">
              <TextInput
                value={chapterTitle}
                onChange={(event) => setChapterTitle(event.target.value)}
                maxLength={300}
              />
            </Field>
            <Field label="章节正文">
              <TextArea
                className="chapter-edit-body"
                value={chapterBody}
                onChange={(event) => setChapterBody(event.target.value)}
                rows={16}
                maxLength={2_000_000}
              />
            </Field>
            {reviseChapter.isError && (
              <p className="form-error" role="alert">
                保存章节修订失败：{reviseChapter.error.message}
              </p>
            )}
            <section className="chapter-version-history">
              <b>历史版本</b>
              {chapterVersions.isLoading ? (
                <small>正在读取版本…</small>
              ) : chapterVersions.isError ? (
                <small className="form-error">版本读取失败：{chapterVersions.error.message}</small>
              ) : (
                chapterVersions.data?.map((version) => (
                  <div key={version.id}>
                    <span>
                      v{version.version} · {version.title} · SHA-256{' '}
                      {version.content_hash.slice(0, 12)}…
                    </span>
                    {version.version !== selectedChapter.version && (
                      <Button
                        size="sm"
                        disabled={restoreChapter.isPending || reviseChapter.isPending}
                        onClick={() => restoreChapter.mutate(version.version)}
                      >
                        {restoreChapter.isPending ? '恢复中…' : '恢复为新版本'}
                      </Button>
                    )}
                  </div>
                ))
              )}
              {restoreChapter.isError && (
                <small className="form-error">版本恢复失败：{restoreChapter.error.message}</small>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function rightsLabel(status?: Project['rights_status']): string {
  return (
    {
      unconfirmed: '待确认',
      owned: '自有版权',
      licensed: '已获授权',
      public_domain: '公版作品',
      restricted: '仅限内部评估',
    } as const
  )[status ?? 'unconfirmed'];
}

function AnalysisStep({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="analysis-step">
      <span>{number}</span>
      <div>
        <b>{title}</b>
        <small>{detail}</small>
      </div>
    </div>
  );
}
