import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, TextArea, TextInput } from '../ui/Field';

type CandidateVersion = {
  revision: number;
  content: string;
  created_at: string;
};

type StoryBibleCandidateReviewProps = {
  modelId: string;
  revision: number;
  savedContent: string;
  content: string;
  versions: CandidateVersion[];
  candidateReason: string;
  isSaving: boolean;
  isDeciding: boolean;
  saveError?: string;
  versionsError?: string;
  decisionError?: string;
  onContentChange: (content: string) => void;
  onReasonChange: (reason: string) => void;
  onSave: () => void;
  onAccept: () => void;
  onReject: () => void;
};

export function StoryBibleCandidateReview({
  modelId,
  revision,
  savedContent,
  content,
  versions,
  candidateReason,
  isSaving,
  isDeciding,
  saveError,
  versionsError,
  decisionError,
  onContentChange,
  onReasonChange,
  onSave,
  onAccept,
  onReject,
}: StoryBibleCandidateReviewProps) {
  const hasUnsavedChanges = content !== savedContent;
  const busy = isSaving || isDeciding;

  return (
    <section className="generation-candidate">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">
            GENERATED CANDIDATE · {modelId} · REVISION {revision}
          </div>
          <h3>故事圣经候选</h3>
          <p>你可以直接修改候选。保存后再验收，接受后才会解锁长篇大纲与文学角色阶段。</p>
        </div>
        <Badge tone="gold" dot>
          等待人工审阅
        </Badge>
      </div>
      <Field label="候选内容">
        <TextArea
          className="generation-output--document"
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          rows={18}
          maxLength={2_000_000}
        />
      </Field>
      {hasUnsavedChanges && (
        <div className="inline-notice">有未保存的人工修改；请先保存，再验收或退回。</div>
      )}
      {versions.length > 1 && (
        <section className="chapter-version-history">
          <b>候选版本记录</b>
          {versions.map((version) => (
            <div key={version.revision}>
              <span>
                v{version.revision} · {new Date(version.created_at).toLocaleString()}
              </span>
              {version.revision === revision ? (
                <Badge tone="green">当前版本</Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => onContentChange(version.content)}
                >
                  载入到编辑区
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="brief-actions">
        <Button type="button" disabled={!hasUnsavedChanges || busy} onClick={onSave}>
          {isSaving ? '保存中…' : '保存候选修改'}
        </Button>
        <Field label="退回修改意见">
          <TextInput
            value={candidateReason}
            onChange={(event) => onReasonChange(event.target.value)}
            maxLength={1000}
            placeholder="说明仍需调整的结构、人物关系或边界"
          />
        </Field>
        <Button
          type="button"
          variant="danger"
          disabled={!candidateReason.trim() || hasUnsavedChanges || busy}
          onClick={onReject}
        >
          退回并要求重生成
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={hasUnsavedChanges || busy}
          onClick={onAccept}
        >
          验收故事圣经
        </Button>
      </div>
      {saveError && (
        <p className="form-error" role="alert">
          候选保存失败：{saveError}
        </p>
      )}
      {versionsError && (
        <p className="form-error" role="alert">
          候选版本读取失败：{versionsError}
        </p>
      )}
      {decisionError && (
        <p className="form-error" role="alert">
          候选审核失败：{decisionError}
        </p>
      )}
    </section>
  );
}
