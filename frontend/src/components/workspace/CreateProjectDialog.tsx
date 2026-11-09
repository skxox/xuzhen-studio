import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  Lightbulb,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { api, apiFieldErrors } from '../../lib/api';
import type { ContentMode, ProjectCreateInput, SourceKind, VideoMode } from '../../lib/types';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, SelectInput, TextInput } from '../ui/Field';
import {
  CONTENT_MODE_OPTIONS,
  SOURCE_KIND_OPTIONS,
  VIDEO_MODE_OPTIONS,
  contentModeUnavailableReason,
  defaultContentModeFor,
} from './projectDimensions';

const SOURCE_ICONS: Record<SourceKind, LucideIcon> = {
  existing_novel: BookOpen,
  ai_novel: Sparkles,
  finished_script: FileText,
  product_material: ShoppingBag,
  creative_brief: Lightbulb,
};

/** D-01a：内容来源、叙事形式、视频路径三个维度独立选择的服务端项目创建表单。 */
export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [sourceKind, setSourceKind] = useState<SourceKind>('existing_novel');
  const [contentMode, setContentMode] = useState<ContentMode>('drama');
  const [videoMode, setVideoMode] = useState<VideoMode>('storyboard_video');
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('都市情感');
  const [rights, setRights] = useState<ProjectCreateInput['rights_status']>('unconfirmed');
  const mutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      setName('');
    },
  });
  const fieldErrors = mutation.isError ? apiFieldErrors(mutation.error) : {};
  const isCommercial = contentMode === 'commercial';

  const selectSourceKind = (next: SourceKind) => {
    setSourceKind(next);
    setContentMode((current) =>
      contentModeUnavailableReason(next, current) ? defaultContentModeFor(next) : current,
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate({
      name: name.trim(),
      source_kind: sourceKind,
      content_mode: contentMode,
      video_mode: videoMode,
      genre: isCommercial && genre === '都市情感' ? '商品短片' : genre,
      target_episodes: isCommercial ? 1 : 12,
      episode_seconds: isCommercial ? 30 : 120,
      aspect_ratio: '16:9',
      rights_status: rights,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="建立制作项目"
      description="分别选择内容来源、叙事形式与视频路径；生成能力由服务端按 Provider 配置判定。"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            type="submit"
            form="create-project-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? '正在创建…' : '创建项目'}
          </Button>
        </>
      }
    >
      <form id="create-project-form" onSubmit={submit} className="form-stack">
        <Field label="项目名称">
          <TextInput
            autoFocus
            required
            maxLength={200}
            placeholder="输入项目名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="field">
          <span className="field__label">内容来源</span>
          <div className="choice-grid" role="radiogroup" aria-label="内容来源">
            {SOURCE_KIND_OPTIONS.map((option) => {
              const Icon = SOURCE_ICONS[option.value];
              const selected = sourceKind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`choice-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => selectSourceKind(option.value)}
                >
                  <Icon size={19} />
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Field
          label="叙事形式"
          hint="决定剧本结构：对白场景、旁白节奏或广告卖点与合规边界。"
          error={fieldErrors.content_mode}
        >
          <SelectInput
            value={contentMode}
            onChange={(event) => setContentMode(event.target.value as ContentMode)}
          >
            {CONTENT_MODE_OPTIONS.map((option) => {
              const reason = contentModeUnavailableReason(sourceKind, option.value);
              return (
                <option key={option.value} value={option.value} disabled={reason !== null}>
                  {option.label}
                  {reason !== null ? `（${reason}）` : ''}
                </option>
              );
            })}
          </SelectInput>
        </Field>
        <Field
          label="视频路径"
          hint="多宫格属于分镜路径的出图选项；所选路径是否可用取决于各 Provider 的能力配置。"
          error={fieldErrors.video_mode}
        >
          <SelectInput
            value={videoMode}
            onChange={(event) => setVideoMode(event.target.value as VideoMode)}
          >
            {VIDEO_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}——{option.description}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="form-row">
          <Field label={isCommercial ? '内容类型' : '题材'}>
            <TextInput
              value={isCommercial && genre === '都市情感' ? '商品短片' : genre}
              onChange={(event) => setGenre(event.target.value)}
            />
          </Field>
          <Field
            label={isCommercial ? '素材权利状态' : '原作权利状态'}
            hint={
              isCommercial
                ? '在商品简报中还需确认具体素材与商标使用授权。'
                : '有权状态记录后，才可通过原文阶段门禁。'
            }
          >
            <SelectInput
              value={rights}
              onChange={(event) =>
                setRights(event.target.value as ProjectCreateInput['rights_status'])
              }
            >
              <option value="unconfirmed">待确认</option>
              <option value="owned">自有版权</option>
              <option value="licensed">已获授权</option>
              <option value="public_domain">公版作品</option>
              <option value="restricted">仅限内部评估</option>
            </SelectInput>
          </Field>
        </div>
        {mutation.isError && !Object.keys(fieldErrors).length && (
          <p className="form-error" role="alert">
            项目创建失败：{mutation.error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
