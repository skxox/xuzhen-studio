import { Maximize2, Pause, Play, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../ui/Dialog';

export function ClipPreview() {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const preview = (
    <div className="preview-image">
      <div className="visual-frame visual-frame--monitor">
        <div className="frame-window" />
        <div className="frame-figure" />
        <div className="frame-furniture" />
      </div>
      <span className="preview-timecode">00:00:08:12</span>
      <span className="preview-source">分镜动态预览</span>
      <button
        className="preview-play"
        aria-label={playing ? '暂停预览' : '播放预览'}
        onClick={() => setPlaying(!playing)}
      >
        {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
      </button>
      <button className="preview-expand" aria-label="放大预览" onClick={() => setExpanded(true)}>
        <Maximize2 size={15} />
      </button>
    </div>
  );
  return (
    <>
      <div className="clip-preview">
        {preview}
        <div className="preview-scrub">
          <span className="scrub-progress" />
          <i />
        </div>
        <div className="preview-controls">
          <button className="quiet-action" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? '暂停' : '播放'}
          </button>
          <span>00:08 / 00:42</span>
          <button aria-label="音量" className="plain-icon">
            <Volume2 size={15} />
          </button>
        </div>
      </div>
      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        title="连续性预览"
        description="当前为镜头节奏占位预览；接入视频服务后将在此播放真实候选。"
      >
        <div className="expanded-preview">{preview}</div>
      </Dialog>
    </>
  );
}
