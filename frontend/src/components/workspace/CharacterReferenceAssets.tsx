import { ImagePlus, UserRound } from 'lucide-react';
import type { CharacterReference } from '../../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, TextArea, TextInput } from '../ui/Field';
import { Panel } from '../ui/Panel';

export function CharacterReferenceCard({
  reference,
  index,
  onOpen,
}: {
  reference: CharacterReference;
  index: number;
  onOpen: () => void;
}) {
  return (
    <Panel className="asset-card">
      <button
        className="asset-visual asset-visual--reference"
        aria-label={`查看角色参考：${reference.name}`}
        onClick={onOpen}
      >
        <UserRound size={32} strokeWidth={1.3} />
        <span className="asset-reference-placeholder">参考图未生成</span>
        <span className="asset-visual__index">R{String(index + 1).padStart(2, '0')}</span>
        <span className="asset-version">v{reference.version}</span>
      </button>
      <div className="asset-card__body">
        <div>
          <Badge tone={statusTone(reference.status)}>{statusLabel(reference.status)}</Badge>
          <span className="asset-reference-date">
            {new Date(reference.updated_at).toLocaleDateString()}
          </span>
        </div>
        <b>{reference.name}</b>
        <small>{reference.immutable_features}</small>
        <footer>
          <span>{reference.reference_views.length} 项视图规则</span>
          <button type="button" className="text-link" onClick={onOpen}>
            查看详情
          </button>
        </footer>
      </div>
    </Panel>
  );
}

export function CharacterReferenceCreateDialog({
  open,
  onClose,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
  isSaving: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="建立角色参考表"
      description="保存角色外观锚点与服装规则。当前只创建文字草稿，不会生成图片。"
      footer={
        <>
          <Button onClick={onClose} disabled={isSaving}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="character-reference-form"
            disabled={isSaving}
          >
            {isSaving ? '正在保存…' : '保存角色草稿'}
          </Button>
        </>
      }
    >
      <form
        id="character-reference-form"
        className="character-reference-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <Field label="角色名称" hint="在剧本、素材引用和分镜中使用的统一名称">
          <TextInput name="name" required maxLength={60} placeholder="输入角色名称" />
        </Field>
        <Field label="不可变特征" hint="年龄感、脸型、发型、肤色、体态或显著标记">
          <TextArea
            name="invariants"
            rows={3}
            required
            maxLength={600}
            placeholder="描述需要跨镜头保持一致的外观特征"
          />
        </Field>
        <Field label="基准服装与状态" hint="说明默认服装、材质、颜色，以及允许切换的条件">
          <TextArea
            name="costume"
            rows={2}
            required
            maxLength={400}
            placeholder="描述默认服装和变化规则"
          />
        </Field>
        <div className="reference-provider-note">
          <ImagePlus size={15} />
          <span>
            <b>只保存文字草稿</b>
            <small>图像生成尚未连接；保存不会创建参考图或调用模型。</small>
          </span>
        </div>
      </form>
    </Dialog>
  );
}

export function CharacterReferenceDetailsDialog({
  reference,
  onClose,
}: {
  reference?: CharacterReference;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(reference)}
      onClose={onClose}
      title={reference?.name ?? '角色参考详情'}
      description={
        reference ? `版本 v${reference.version} · ${statusLabel(reference.status)}` : undefined
      }
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {reference && (
        <div className="reference-details">
          <DetailField label="不可变特征">{reference.immutable_features}</DetailField>
          <DetailField label="服装规则">{reference.costume_rules}</DetailField>
          <DetailField label="参考视图">
            {reference.reference_views.map(viewLabel).join('、') || '未设置'}
          </DetailField>
          <DetailField label="最近更新">
            {new Date(reference.updated_at).toLocaleString()}
          </DetailField>
          <div className="reference-provider-note">
            <ImagePlus size={15} />
            <span>
              <b>参考图未生成</b>
              <small>图片任务和引用镜头暂未接入。</small>
            </span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function DetailField({ label, children }: { label: string; children: string }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <p>{children}</p>
    </div>
  );
}

function statusLabel(status: CharacterReference['status']) {
  const labels: Record<CharacterReference['status'], string> = {
    draft: '草稿',
    needs_review: '待审阅',
    accepted: '已验收',
    rejected: '已退回',
  };
  return labels[status];
}

function statusTone(status: CharacterReference['status']): 'neutral' | 'gold' | 'green' | 'red' {
  if (status === 'needs_review') return 'gold';
  if (status === 'accepted') return 'green';
  if (status === 'rejected') return 'red';
  return 'neutral';
}

function viewLabel(view: CharacterReference['reference_views'][number]) {
  const labels: Record<CharacterReference['reference_views'][number], string> = {
    front_full_body: '正面全身',
    side_full_body: '侧面全身',
    back_full_body: '背面全身',
    expression_sheet: '表情设定',
  };
  return labels[view];
}
