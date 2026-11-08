import { Panel } from '../ui/Panel';

type SubtitleCue = { start_ms: number; end_ms: number; text: string };

export function SubtitlePreviewPanel({ cues }: { cues: SubtitleCue[] }) {
  return (
    <Panel className="delivery-quality">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SUBTITLE PREVIEW</div>
          <h3>字幕抽样</h3>
        </div>
      </div>
      {cues.length ? (
        <ol className="subtitle-preview">
          {cues.slice(0, 10).map((cue, index) => (
            <li key={`${cue.start_ms}-${index}`}>
              <time>{formatTime(cue.start_ms)}</time>
              <span>{cue.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>剪辑包生成后显示锁定剧本对应的字幕抽样。</p>
      )}
    </Panel>
  );
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
