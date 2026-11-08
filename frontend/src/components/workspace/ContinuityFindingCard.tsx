import { Badge } from '../ui/Badge';
import { Field, SelectInput, TextInput } from '../ui/Field';

export type ContinuityFinding = {
  finding_id: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  chapter_ordinal: number;
  evidence_quote: string;
  related_chapter_ordinal?: number | null;
  related_evidence_quote?: string | null;
  issue: string;
  recommendation: string;
  status: 'open' | 'resolved' | 'accepted_risk';
  resolution_note: string;
};

export function ContinuityFindingCard({
  finding,
  editable,
  onUpdate,
}: {
  finding: ContinuityFinding;
  editable: boolean;
  onUpdate: (update: Partial<ContinuityFinding>) => void;
}) {
  const severityTone =
    finding.severity === 'high' ? 'red' : finding.severity === 'medium' ? 'gold' : 'neutral';
  const severityLabel =
    finding.severity === 'high' ? '高风险' : finding.severity === 'medium' ? '中风险' : '低风险';
  const statusTone =
    finding.status === 'resolved'
      ? 'green'
      : finding.status === 'accepted_risk'
        ? 'gold'
        : 'neutral';
  const statusLabel =
    finding.status === 'resolved'
      ? '已处理'
      : finding.status === 'accepted_risk'
        ? '接受风险'
        : '待处理';

  return (
    <article className="continuity-finding">
      <header>
        <div>
          <Badge tone={severityTone}>{severityLabel}</Badge>
          <Badge>{finding.category}</Badge>
          <span>
            第 {finding.chapter_ordinal} 章 · #{finding.finding_id}
          </span>
        </div>
      </header>
      <blockquote>{finding.evidence_quote}</blockquote>
      {finding.related_evidence_quote ? (
        <blockquote className="continuity-finding__related">
          第 {finding.related_chapter_ordinal} 章 · {finding.related_evidence_quote}
        </blockquote>
      ) : null}
      <p>
        <strong>问题：</strong>
        {finding.issue}
      </p>
      <p>
        <strong>建议：</strong>
        {finding.recommendation}
      </p>
      {editable ? (
        <div className="continuity-finding__edit">
          <Field label="处置">
            <SelectInput
              value={finding.status}
              onChange={(event) =>
                onUpdate({ status: event.target.value as ContinuityFinding['status'] })
              }
            >
              <option value="open">待处理</option>
              <option value="resolved">已处理</option>
              <option value="accepted_risk">接受风险</option>
            </SelectInput>
          </Field>
          <Field
            label="处理说明"
            hint={
              finding.status === 'open'
                ? '待处理时可留空。已处理或接受风险必须填写。'
                : '写明具体修订依据或接受风险的理由。'
            }
          >
            <TextInput
              value={finding.resolution_note}
              onChange={(event) => onUpdate({ resolution_note: event.target.value })}
              maxLength={1000}
              placeholder="说明如何处理或为何接受风险"
            />
          </Field>
        </div>
      ) : (
        <Badge tone={statusTone}>{statusLabel}</Badge>
      )}
    </article>
  );
}
