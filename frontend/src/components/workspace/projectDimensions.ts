import type { ContentMode, Project, SourceKind, VideoMode } from '../../lib/types';

/** D-01a 创作维度选项与组合规则；与服务端 domain/project_dimensions.py 保持一致。 */

export interface DimensionOption<T extends string> {
  value: T;
  label: string;
  description: string;
}

export const SOURCE_KIND_OPTIONS: DimensionOption<SourceKind>[] = [
  {
    value: 'existing_novel',
    label: '已有小说',
    description: '导入 TXT/MD 原文，建立出处、权利与锁版',
  },
  {
    value: 'ai_novel',
    label: 'AI 原创小说',
    description: '从创意简报逐步写成小说，再交接视频制作',
  },
  {
    value: 'finished_script',
    label: '成品剧本',
    description: '导入既有剧本结构，直接进入制作链',
  },
  {
    value: 'product_material',
    label: '商品素材',
    description: '整理商品事实、素材与宣传合规边界',
  },
  {
    value: 'creative_brief',
    label: '创意简报',
    description: '以创意构想为来源，直接规划视频内容',
  },
];

export const CONTENT_MODE_OPTIONS: DimensionOption<ContentMode>[] = [
  { value: 'drama', label: '剧情演绎', description: '场景、动作与对白的结构化剧本' },
  { value: 'narration', label: '旁白/解说', description: '旁白段落、画面意图与节奏' },
  { value: 'commercial', label: '广告短片', description: '卖点、证据、口播与行动号召' },
];

export const VIDEO_MODE_OPTIONS: DimensionOption<VideoMode>[] = [
  {
    value: 'storyboard_video',
    label: '分镜图生视频',
    description: '先分镜并生成关键帧，再逐镜生成视频',
  },
  {
    value: 'reference_video',
    label: '参考图生视频',
    description: '以角色/场景/商品参考图驱动生成',
  },
];

const COMMERCIAL_SOURCE_KINDS = new Set<SourceKind>(['product_material', 'creative_brief']);
const COMMERCIAL_ONLY_SOURCE_KINDS = new Set<SourceKind>(['product_material']);

/** 返回叙事形式与内容来源不兼容的原因；null 表示可用。 */
export function contentModeUnavailableReason(
  sourceKind: SourceKind,
  contentMode: ContentMode,
): string | null {
  if (contentMode === 'commercial' && !COMMERCIAL_SOURCE_KINDS.has(sourceKind)) {
    return '广告短片只支持“商品素材”或“创意简报”来源';
  }
  if (COMMERCIAL_ONLY_SOURCE_KINDS.has(sourceKind) && contentMode !== 'commercial') {
    return '商品素材只支持广告短片叙事';
  }
  return null;
}

/** 切换来源后的默认叙事形式，保证状态始终落在合法组合上。 */
export function defaultContentModeFor(sourceKind: SourceKind): ContentMode {
  return sourceKind === 'product_material' ? 'commercial' : 'drama';
}

/** 项目卡与侧栏的来源标签；新项目显示双维，旧项目回退旧模式名。 */
export function projectKindLabel(
  project: Pick<Project, 'creation_mode' | 'source_kind' | 'content_mode'>,
): string {
  const source = SOURCE_KIND_OPTIONS.find((option) => option.value === project.source_kind);
  const content = CONTENT_MODE_OPTIONS.find((option) => option.value === project.content_mode);
  if (source && content) return `${source.label} · ${content.label}`;
  if (project.creation_mode === 'original') return '原创小说';
  if (project.creation_mode === 'commercial') return '商品短片';
  return '小说改编';
}
