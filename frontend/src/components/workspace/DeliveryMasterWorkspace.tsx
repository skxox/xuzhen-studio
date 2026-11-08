import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Film, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { api } from '../../lib/api';
import type { Project } from '../../lib/types';

type Props = {
  project: Project;
  deliveryStatus?: string;
  postStatus?: string;
};

export function DeliveryMasterWorkspace({ project, deliveryStatus, postStatus }: Props) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const mastersQuery = useQuery({
    queryKey: ['delivery-masters', project.id],
    queryFn: () => api.deliveryMasters(project.id),
  });
  const runtimeQuery = useQuery({
    queryKey: ['delivery-runtime'],
    queryFn: api.deliveryRuntime,
  });
  const masters = mastersQuery.data ?? [];
  const latestMaster = masters[0];
  const qualityReport = latestMaster?.source_snapshot.quality_report;
  const refresh = async () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['delivery-masters', project.id] }),
      client.invalidateQueries({ queryKey: ['stages', project.id] }),
    ]);
  const render = useMutation({
    mutationFn: async () => {
      if (postStatus !== 'accepted') throw new Error('请先验收后期剪辑交接包。');
      if (project.rights_status === 'unconfirmed' || project.rights_status === 'restricted')
        throw new Error('请先确认项目素材的使用权利。');
      if (!runtimeQuery.data?.master_render_available)
        throw new Error(runtimeQuery.data?.message ?? 'FFmpeg 尚未就绪。');
      if (deliveryStatus === 'needs_review') throw new Error('请先审阅当前母版候选。');
      if (deliveryStatus !== 'running') await api.startStage(project.id, 'delivery');
      return api.renderDeliveryMaster(project.id);
    },
    onSuccess: refresh,
    onError: refresh,
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(
        project.id,
        'delivery',
        action,
        action === 'reject' ? reason.trim() : undefined,
      ),
    onSuccess: async () => {
      setReason('');
      await refresh();
    },
  });
  const error = render.error ?? decide.error ?? mastersQuery.error ?? runtimeQuery.error;
  const supportedMode = project.creation_mode === 'original';
  const ready =
    supportedMode &&
    postStatus === 'accepted' &&
    project.rights_status !== 'unconfirmed' &&
    project.rights_status !== 'restricted';
  return (
    <Panel className="master-render-panel">
      <div className="workspace-section-heading">
        <div>
          <span className="eyebrow">FINAL MASTER · FFMPEG</span>
          <h2>合成最终视频</h2>
        </div>
        <Badge tone={latestMaster?.status === 'accepted' ? 'green' : 'gold'}>
          {latestMaster ? `母版 v${latestMaster.revision} · ${latestMaster.status}` : '尚未合成'}
        </Badge>
      </div>
      <p>
        按镜头顺序拼接视频，将逐句配音按字幕时间位置混合，并嵌入可切换的中文字幕轨。FFprobe
        会检查容器、视频/音频/字幕轨、数据包和实际时长；通过后仍需人工审片。
      </p>
      {!runtimeQuery.isLoading && !runtimeQuery.data?.master_render_available && (
        <p className="form-error">{runtimeQuery.data?.message ?? 'FFmpeg 运行状态检查失败。'}</p>
      )}
      {!ready && (
        <p>
          {!supportedMode
            ? '当前最终母版合成仅支持已锁定剧本的原创项目。'
            : '需要先验收剪辑交接包，并将项目素材权利标记为自有、已授权或公有领域。'}{' '}
          {supportedMode && <Link to="/source">检查权利状态</Link>}
        </p>
      )}
      {latestMaster?.status === 'needs_review' && (
        <div className="master-preview">
          <video
            controls
            preload="metadata"
            src={api.deliveryMasterFileUrl(project.id, latestMaster.id)}
          />
          <p>
            {latestMaster.width} × {latestMaster.height} · 目标时长{' '}
            {latestMaster.duration_seconds.toFixed(1)} 秒实测 ·{' '}
            {(latestMaster.size_bytes / 1_000_000).toFixed(1)} MB · SHA{' '}
            {latestMaster.sha256.slice(0, 12)}
          </p>
          {qualityReport ? (
            <p>
              自动检查通过 · H.264 {qualityReport.video.packets_read} 包 · AAC{' '}
              {qualityReport.audio.packets_read} 包 · 字幕 {qualityReport.subtitle.packets_read} 条
              · 时长偏差 {qualityReport.duration_delta_seconds.toFixed(2)} 秒
            </p>
          ) : (
            <p className="form-error">该母版没有新版 FFprobe 质量报告，请退回并重新合成。</p>
          )}
          <label className="field">
            <span>退回原因</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：配音与画面不同步"
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
              disabled={decide.isPending || !qualityReport?.passed}
            >
              验收最终母版
            </Button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error.message}</p>}
      <div className="workspace-actions">
        <Button
          variant="primary"
          icon={latestMaster ? <RefreshCw size={15} /> : <Film size={15} />}
          disabled={
            !ready ||
            !runtimeQuery.data?.master_render_available ||
            render.isPending ||
            deliveryStatus === 'needs_review'
          }
          onClick={() => render.mutate()}
        >
          {render.isPending ? '正在合成视频…' : latestMaster ? '生成新母版修订' : '合成最终视频'}
        </Button>
        {latestMaster?.status === 'accepted' && (
          <a
            className="text-link"
            href={api.deliveryMasterFileUrl(project.id, latestMaster.id)}
            download
          >
            <Download size={15} /> 下载已验收母版
          </a>
        )}
      </div>
      {masters.length > 1 && (
        <details>
          <summary>查看历史母版 ({masters.length - 1})</summary>
          {masters.slice(1).map((master) => (
            <p key={master.id}>
              v{master.revision} · {master.status} · SHA {master.sha256.slice(0, 10)} ·{' '}
              <a href={api.deliveryMasterFileUrl(project.id, master.id)} download>
                下载
              </a>
            </p>
          ))}
        </details>
      )}
    </Panel>
  );
}
