import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Check, Clapperboard, Film, Subtitles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DeliveryMasterWorkspace } from '../components/workspace/DeliveryMasterWorkspace';
import { SubtitlePreviewPanel } from '../components/workspace/SubtitlePreviewPanel';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project } from '../lib/types';

export function DeliveryPage({ project }: { project?: Project }) {
  const projectId = project?.id;
  const [reason, setReason] = useState('');
  const [subtitleDraft, setSubtitleDraft] = useState<{
    packageId: string;
    value: string;
  } | null>(null);
  const client = useQueryClient();
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const packagesQuery = useQuery({
    queryKey: ['edit-packages', projectId],
    queryFn: () => api.editPackages(projectId!),
    enabled: Boolean(projectId),
  });
  const packageDetailQuery = useQuery({
    queryKey: ['edit-package', projectId, packagesQuery.data?.[0]?.id],
    queryFn: () => api.editPackage(projectId!, packagesQuery.data![0].id),
    enabled: Boolean(projectId && packagesQuery.data?.[0]?.id),
  });
  const plansQuery = useQuery({
    queryKey: ['shot-plan-releases', projectId],
    queryFn: () => api.shotPlanReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const videosQuery = useQuery({
    queryKey: ['video-candidates', projectId],
    queryFn: () => api.videoCandidates(projectId!),
    enabled: Boolean(projectId),
  });
  const audioQuery = useQuery({
    queryKey: ['audio-candidates', projectId],
    queryFn: () => api.audioCandidates(projectId!),
    enabled: Boolean(projectId),
  });
  const scriptsQuery = useQuery({
    queryKey: ['script-releases', projectId],
    queryFn: () => api.scriptReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === 'post');
  const voiceStage = stages.find((item) => item.stage_key === 'voice');
  const scriptStage = stages.find((item) => item.stage_key === 'script');
  const deliveryStage = stages.find((item) => item.stage_key === 'delivery');
  const plan = plansQuery.data?.find((item) => item.is_current);
  const latestPackage = packagesQuery.data?.[0];
  const packageDetail = packageDetailQuery.data;
  const currentSubtitleDraft =
    subtitleDraft && subtitleDraft.packageId === latestPackage?.id ? subtitleDraft.value : null;
  const hasSubtitleChanges =
    currentSubtitleDraft !== null && currentSubtitleDraft !== packageDetail?.subtitle_srt;
  const candidates = (videosQuery.data ?? []).filter(
    (item) => item.shot_plan_release_id === plan?.id && item.status === 'accepted',
  );
  const scriptReleaseId = String(scriptStage?.decision.script_release_id ?? '');
  const currentScript = scriptsQuery.data?.find((item) => item.id === scriptReleaseId);
  const requiredDialogues =
    currentScript?.episodes.reduce(
      (count, episode) =>
        count +
        episode.scenes.reduce((sceneCount, scene) => sceneCount + scene.dialogues.length, 0),
      0,
    ) ?? 0;
  const acceptedDialogueKeys = new Set(
    (audioQuery.data ?? [])
      .filter((item) => item.status === 'accepted' && item.script_release_id === scriptReleaseId)
      .map((item) => `${item.episode_number}:${item.scene_number}:${item.dialogue_number}`),
  );
  const acceptedDialogueCount = acceptedDialogueKeys.size;
  const voiceComplete = Boolean(
    currentScript &&
    requiredDialogues > 0 &&
    voiceStage?.status === 'accepted' &&
    acceptedDialogueCount === requiredDialogues,
  );
  const expectedShots = plan?.shot_count ?? 0;
  const videoComplete = Boolean(
    plan &&
    expectedShots > 0 &&
    stages.find((item) => item.stage_key === 'video')?.status === 'accepted' &&
    candidates.length === expectedShots,
  );
  const complete = videoComplete && voiceComplete;
  const refresh = async () =>
    Promise.all(
      ['stages', 'edit-packages'].map((key) =>
        client.invalidateQueries({ queryKey: [key, projectId] }),
      ),
    );
  const create = useMutation({
    mutationFn: async () => {
      if (!projectId || !complete)
        throw new Error('请先完成当前分镜的逐镜视频和当前剧本的逐句配音验收。');
      if (stage?.status === 'needs_review') throw new Error('请先验收或退回当前剪辑包。');
      if (stage?.status !== 'running') await api.startStage(projectId, 'post');
      return api.createEditPackage(projectId);
    },
    onSuccess: refresh,
    onError: refresh,
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(projectId!, 'post', action, action === 'reject' ? reason.trim() : undefined),
    onSuccess: async () => {
      setReason('');
      await refresh();
    },
  });
  const saveSubtitles = useMutation({
    mutationFn: () => {
      if (!projectId || !latestPackage || currentSubtitleDraft === null)
        throw new Error('字幕没有待保存的修订。');
      return api.updateEditPackageSubtitles(projectId, latestPackage.id, currentSubtitleDraft);
    },
    onSuccess: async () => {
      setSubtitleDraft(null);
      await refresh();
    },
  });
  const error =
    create.error ??
    decide.error ??
    saveSubtitles.error ??
    stagesQuery.error ??
    packagesQuery.error ??
    packageDetailQuery.error ??
    audioQuery.error ??
    scriptsQuery.error ??
    plansQuery.error ??
    videosQuery.error;
  const subtitlePreview = packageDetail?.source_snapshot.subtitle_preview ?? [];
  return (
    <div className="delivery-page">
      <PageHeading
        eyebrow="POST-PRODUCTION · HANDOFF"
        title="整理经过审阅的成片素材。"
        description="汇总已验收视频、逐句配音和中文字幕，生成可继续编辑的剪辑交接包。交接包尚未混音或渲染为最终母版。"
        actions={
          <Badge tone={stage?.status === 'accepted' ? 'green' : 'gold'} dot>
            后期阶段 · {stage?.status ?? '等待上游'}
          </Badge>
        }
      />
      {!projectId && (
        <Panel>
          <p>请先选择项目。</p>
        </Panel>
      )}
      {projectId && (
        <div className="delivery-grid">
          <Panel className="delivery-master">
            <div className="delivery-master__head">
              <div>
                <Badge tone={complete ? 'green' : 'gold'}>
                  {complete ? '视频与配音齐备' : '等待视频与配音验收'}
                </Badge>
                <h2>{project.name}</h2>
                <p>
                  视频 {candidates.length} / {expectedShots} · 配音 {acceptedDialogueCount} /{' '}
                  {requiredDialogues} 句 · 分镜 v{plan?.revision ?? '—'}
                </p>
              </div>
              <Film size={24} />
            </div>
            {!complete && (
              <p>
                {!videoComplete ? (
                  <>
                    需要当前分镜下的每个镜头都有已验收视频候选。{' '}
                    <Link to="/writing/video">前往逐镜视频审片</Link>
                  </>
                ) : (
                  <>
                    需要当前锁定剧本的每句对白都有已验收配音。{' '}
                    <Link to="/writing/voice">前往逐句配音审阅</Link>
                  </>
                )}
              </p>
            )}
            {stage?.status === 'running' && !create.isPending && (
              <p>
                当前阶段没有可审阅的交接包。点击重新打包会重新检查素材并创建新的修订；当前打包由 API
                请求同步执行。
              </p>
            )}
            {complete && (
              <details className="delivery-clips">
                <summary>预览本次剪辑包收录的 {candidates.length} 条镜头视频</summary>
                <div className="delivery-clips__grid">
                  {candidates.map((item) => (
                    <article key={item.id}>
                      <video controls preload="none" src={api.videoFileUrl(projectId, item.id)} />
                      <span>
                        EP{item.episode_number} · SC{item.scene_number} · SH{item.shot_number}
                      </span>
                    </article>
                  ))}
                </div>
              </details>
            )}
            {error && <p className="form-error">{error.message}</p>}
            {stage?.status === 'needs_review' && latestPackage?.status === 'needs_review' && (
              <div className="package-review">
                <h3>剪辑包 v{latestPackage.revision} 等待审核</h3>
                <p>
                  压缩包包含 {latestPackage.shot_count} 条视频、{latestPackage.audio_count} 条配音和{' '}
                  {latestPackage.subtitle_count} 条字幕。请下载并检查字幕时间码与镜头顺序。
                </p>
                <a className="text-link" href={api.editPackageFileUrl(projectId, latestPackage.id)}>
                  <ArrowDownToLine size={15} /> 下载并检查剪辑包
                </a>
                <details className="subtitle-editor">
                  <summary>在工作台编辑 SRT 字幕（保存会创建新版本）</summary>
                  <p>
                    此处用于微调字幕时间码。字幕文字需与已验收剧本和配音一致；修改台词请回到剧本阶段修订并重新生成配音。
                  </p>
                  <textarea
                    rows={16}
                    value={currentSubtitleDraft ?? packageDetail?.subtitle_srt ?? ''}
                    onChange={(event) =>
                      latestPackage &&
                      setSubtitleDraft({ packageId: latestPackage.id, value: event.target.value })
                    }
                    aria-label="编辑剪辑包 SRT 字幕"
                    placeholder="正在载入字幕…"
                    disabled={packageDetailQuery.isLoading}
                  />
                  <div className="workspace-actions">
                    <Button
                      onClick={() => setSubtitleDraft(null)}
                      disabled={!hasSubtitleChanges || saveSubtitles.isPending}
                    >
                      放弃未保存修改
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => saveSubtitles.mutate()}
                      disabled={
                        !hasSubtitleChanges ||
                        saveSubtitles.isPending ||
                        packageDetailQuery.isLoading
                      }
                    >
                      {saveSubtitles.isPending ? '正在生成新修订…' : '保存字幕并生成新版本'}
                    </Button>
                  </div>
                </details>
                <label>
                  退回原因
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="例如：镜头顺序或字幕内容需要调整"
                  />
                </label>
                <div className="workspace-actions">
                  <Button
                    onClick={() => decide.mutate('reject')}
                    disabled={!reason.trim() || decide.isPending}
                  >
                    退回重做
                  </Button>
                  <Button
                    variant="primary"
                    icon={<Check size={15} />}
                    onClick={() => decide.mutate('accept')}
                    disabled={decide.isPending}
                  >
                    验收后期交接包
                  </Button>
                </div>
              </div>
            )}
            <div className="delivery-master__actions">
              <Button
                variant="primary"
                icon={<Clapperboard size={15} />}
                disabled={!complete || create.isPending || stage?.status === 'needs_review'}
                onClick={() => create.mutate()}
              >
                {create.isPending
                  ? '正在打包视频、配音和字幕…'
                  : stage?.status === 'running'
                    ? '恢复并重新打包'
                    : '生成剪辑交接包'}
              </Button>
              {stage?.status === 'accepted' && latestPackage && (
                <a className="text-link" href={api.editPackageFileUrl(projectId, latestPackage.id)}>
                  <ArrowDownToLine size={15} /> 下载已验收版本
                </a>
              )}
            </div>
          </Panel>
          <aside className="delivery-side">
            <Panel className="delivery-quality">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">EDIT PACKAGE</div>
                  <h3>包内文件</h3>
                </div>
                <Subtitles size={18} />
              </div>
              <div className="export-files">
                <div>
                  <Film size={15} />
                  <span>
                    逐镜 MP4<small>按锁定分镜顺序组织</small>
                  </span>
                  <Badge tone={complete ? 'green' : 'gold'}>
                    {candidates.length}/{expectedShots}
                  </Badge>
                </div>
                <div>
                  <Subtitles size={15} />
                  <span>
                    中文字幕<small>SRT · 按请求时长估算</small>
                  </span>
                  <Badge>{latestPackage ? `${latestPackage.subtitle_count} 行` : '待生成'}</Badge>
                </div>
                <div>
                  <Clapperboard size={15} />
                  <span>
                    逐句配音<small>独立音频片段 · 不含混音</small>
                  </span>
                  <Badge tone={voiceComplete ? 'green' : 'gold'}>
                    {latestPackage
                      ? `${latestPackage.audio_count} 条`
                      : `${acceptedDialogueCount}/${requiredDialogues}`}
                  </Badge>
                </div>
                <div>
                  <Clapperboard size={15} />
                  <span>
                    来源清单<small>manifest.json · 含上游版本 ID</small>
                  </span>
                  <Badge>
                    {latestPackage ? `SHA ${latestPackage.sha256.slice(0, 8)}` : '待生成'}
                  </Badge>
                </div>
              </div>
              <p className="quality-footer">
                SRT
                时间码以视频请求时长估算，正式成片前需按素材实际时长校准。交接包包含逐句配音，但不含混音和最终视频合成。
              </p>
              {latestPackage && (
                <p>
                  最近版本 v{latestPackage.revision} ·{' '}
                  {(latestPackage.size_bytes / 1_000_000).toFixed(1)} MB ·{' '}
                  {new Date(latestPackage.created_at).toLocaleString()}
                </p>
              )}
            </Panel>
            <SubtitlePreviewPanel cues={subtitlePreview} />
          </aside>
        </div>
      )}
      {project && (
        <DeliveryMasterWorkspace
          project={project}
          deliveryStatus={deliveryStage?.status}
          postStatus={stage?.status}
        />
      )}
      {deliveryStage?.status === 'ready' && (
        <Panel>
          <p className="success-copy">后期交接包已验收，可以生成最终视频母版。</p>
        </Panel>
      )}
      {latestPackage && (packagesQuery.data?.length ?? 0) > 1 && (
        <Panel>
          <h3>历史剪辑包</h3>
          {packagesQuery.data?.slice(1).map((item) => (
            <p key={item.id}>
              v{item.revision} · {item.status} · {item.shot_count} 镜头 · {item.audio_count} 配音 ·{' '}
              <a href={api.editPackageFileUrl(projectId!, item.id)}>下载</a>
            </p>
          ))}
        </Panel>
      )}
    </div>
  );
}
