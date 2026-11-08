import { useState } from 'react';
import {
  ArrowDownToLine,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  FileVideo,
  MessageSquareText,
  Play,
  ShieldCheck,
  Subtitles,
} from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Panel, PageHeading } from '../components/ui/Panel';

export function DeliveryPage() {
  const [toast, setToast] = useState('');
  return (
    <div className="delivery-page">
      <PageHeading
        eyebrow="REVIEW & DELIVERY"
        title="审片决定，要能回到具体镜头。"
        description="成片版本、批注、字幕、来源清单和导出参数都留在同一条交付记录里。"
        actions={
          <Badge tone="gold" dot>
            第 3 集 · 预交付检查中
          </Badge>
        }
      />
      <div className="delivery-grid">
        <Panel className="delivery-master">
          <div className="delivery-monitor">
            <div className="monitor-room">
              <div className="monitor-room__light" />
              <div className="monitor-room__figure" />
            </div>
            <div className="monitor-shade">
              <span>EP03 · CUT 08</span>
              <button aria-label="播放预览">
                <Play size={18} fill="currentColor" />
              </button>
              <small>00:00:34 / 00:01:46</small>
            </div>
          </div>
          <div className="delivery-master__head">
            <div>
              <Badge tone="blue">预览合成 · v02</Badge>
              <h2>空白的十一分钟</h2>
              <p>8 个镜头 · 临时合成 · 尚未通过阶段门禁</p>
            </div>
            <Button>
              选择版本 <ChevronRight size={14} />
            </Button>
          </div>
          <div className="delivery-timeline">
            <div className="timeline-ruler">
              <span>00:00</span>
              <span>00:30</span>
              <span>01:00</span>
              <span>01:30</span>
              <span>01:46</span>
            </div>
            <div className="timeline-track track-video">
              {Array.from({ length: 8 }, (_, i) => (
                <i
                  key={i}
                  className={i === 4 ? 'has-note' : ''}
                  style={{ flex: i % 3 === 0 ? 1.4 : 1 }}
                >
                  <span>SH {String(i + 1).padStart(2, '0')}</span>
                </i>
              ))}
            </div>
            <div className="timeline-track track-audio">
              <AudioLines size={13} />
              <i />
            </div>
            <div className="timeline-track track-captions">
              <Subtitles size={13} />
              <i />
            </div>
          </div>
          <div className="delivery-master__actions">
            <button
              className="quiet-action"
              onClick={() => setToast('批注已定位到当前预览时间码 00:34。')}
            >
              <MessageSquareText size={14} />
              添加时间码批注
            </button>
            <span />
            <Button variant="primary" onClick={() => setToast('审片通过前仍有 2 项检查未满足。')}>
              提交审片决定 <ChevronRight size={14} />
            </Button>
          </div>
        </Panel>
        <aside className="delivery-side">
          <Panel className="delivery-quality">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">DELIVERY CHECKS</div>
                <h3>交付前检查</h3>
              </div>
              <Badge tone="gold">4 / 6</Badge>
            </div>
            <DeliveryCheck title="镜头视频候选完整" detail="8 / 8 已接受" done />
            <DeliveryCheck title="对白与字幕覆盖" detail="12 行 · 1 处待校对" warn />
            <DeliveryCheck title="音画同步与响度" detail="检测已通过" done />
            <DeliveryCheck title="画面轴线连续性" detail="Shot 04 · 需复核" warn />
            <DeliveryCheck title="素材权利与出处清单" detail="1 项音乐素材未确认" warn />
            <DeliveryCheck title="母版编码与文件校验" detail="导出后运行" />
            <div className="quality-footer">
              <ShieldCheck size={15} />
              <span>失败项须修复或由有权限者记录可追溯的风险豁免。</span>
            </div>
          </Panel>
          <Panel className="delivery-exports">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">EXPORT PROFILE</div>
                <h3>导出配置</h3>
              </div>
              <button className="text-link">编辑</button>
            </div>
            <div className="export-profile">
              <b>竖屏短剧 · 审片预览</b>
              <span>H.264 · 1080 × 1920 · 25 fps</span>
              <span>简体中文字幕 · 无水印</span>
            </div>
            <div className="export-files">
              <div>
                <FileVideo size={15} />
                <span>
                  MP4 母版<small>视频与混音轨</small>
                </span>
                <Badge>待生成</Badge>
              </div>
              <div>
                <Subtitles size={15} />
                <span>
                  字幕文件<small>SRT · VTT</small>
                </span>
                <Badge tone="green">已就绪</Badge>
              </div>
              <div>
                <CheckCheck size={15} />
                <span>
                  来源清单<small>manifest.json</small>
                </span>
                <Badge tone="gold">1 项待确认</Badge>
              </div>
            </div>
            <Button
              variant="primary"
              icon={<ArrowDownToLine size={15} />}
              onClick={() => setToast('导出任务未创建：请先处理待复核门禁。')}
            >
              生成交付包
            </Button>
          </Panel>
        </aside>
      </div>
      <div className="delivery-history">
        <div className="eyebrow">REVISION HISTORY</div>
        <h3>交付修订链</h3>
        <div className="revision-row">
          <span className="revision-dot is-current" />
          <div>
            <b>Cut v02 · 当前预览</b>
            <small>今天 14:32 · 更新 Shot 06 和字幕 · 未通过最终审片</small>
          </div>
          <Badge tone="gold">进行中</Badge>
          <button className="text-link">查看差异</button>
        </div>
        <div className="revision-row">
          <span className="revision-dot" />
          <div>
            <b>Cut v01 · 内部试片</b>
            <small>昨天 18:10 · 1 条审片意见 · 已归档</small>
          </div>
          <Badge>历史版本</Badge>
          <button className="text-link">恢复分支</button>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-mark">
            <Check size={13} />
          </span>
          {toast}
          <button onClick={() => setToast('')} aria-label="关闭">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function DeliveryCheck({
  title,
  detail,
  done,
  warn,
}: {
  title: string;
  detail: string;
  done?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={`delivery-check ${done ? 'is-done' : ''} ${warn ? 'is-warn' : ''}`}>
      <span>{done ? <Check size={13} /> : warn ? '!' : '·'}</span>
      <b>{title}</b>
      <small>{detail}</small>
      <button aria-label={`查看${title}`}>›</button>
    </div>
  );
}
