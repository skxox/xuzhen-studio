import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Search, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import type { CharacterReference, Project } from '../lib/types';
import {
  CharacterReferenceCard,
  CharacterReferenceCreateDialog,
  CharacterReferenceDetailsDialog,
} from '../components/workspace/CharacterReferenceAssets';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeading, Panel } from '../components/ui/Panel';

type ReferenceFilter = 'all' | CharacterReference['status'];

const filters: Array<{ value: ReferenceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'needs_review', label: '待审阅' },
  { value: 'accepted', label: '已验收' },
  { value: 'rejected', label: '已退回' },
];

export function AssetsPage({ project }: { project?: Project }) {
  const [filter, setFilter] = useState<ReferenceFilter>('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedReference, setSelectedReference] = useState<CharacterReference>();
  const [toast, setToast] = useState('');
  const queryClient = useQueryClient();
  const referencesQuery = useQuery({
    queryKey: ['character-references', project?.id],
    queryFn: () => api.characterReferences(project!.id),
    enabled: Boolean(project?.id),
    retry: false,
  });
  const createReference = useMutation({
    mutationFn: (body: { name: string; immutable_features: string; costume_rules: string }) =>
      api.createCharacterReference(project!.id, body),
    onSuccess: async (reference) => {
      await queryClient.invalidateQueries({ queryKey: ['character-references', project?.id] });
      setCreateOpen(false);
      setToast(`已保存「${reference.name}」角色参考草稿 v${reference.version}。图片尚未生成。`);
    },
    onError: (error) => setToast(`保存失败：${error.message}`),
  });
  const references = referencesQuery.data ?? [];
  const counts = Object.fromEntries(
    filters.map(({ value }) => [
      value,
      value === 'all'
        ? references.length
        : references.filter((item) => item.status === value).length,
    ]),
  ) as Record<ReferenceFilter, number>;
  const visibleReferences = references.filter((reference) => {
    const matchesStatus = filter === 'all' || reference.status === filter;
    const matchesName = reference.name
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
    return matchesStatus && matchesName;
  });

  const createCharacterDraft = (form: FormData) => {
    const name = String(form.get('name') ?? '').trim();
    const immutableFeatures = String(form.get('invariants') ?? '').trim();
    const costumeRules = String(form.get('costume') ?? '').trim();
    if (!name || !immutableFeatures || !costumeRules || !project) return;
    createReference.mutate({
      name,
      immutable_features: immutableFeatures,
      costume_rules: costumeRules,
    });
  };

  return (
    <div className="assets-page">
      <PageHeading
        eyebrow="PROJECT ASSETS"
        title="角色参考"
        description="查看并维护当前项目已保存的角色外观锚点。角色参考图生成、场景与道具资产、引用关系和版本锁定将在对应服务接通后开放。"
        actions={
          <Button
            variant="primary"
            icon={<ImagePlus size={15} />}
            onClick={() => setCreateOpen(true)}
            disabled={!project || createReference.isPending}
            title={!project ? '先选择或创建项目，才能保存角色参考' : undefined}
          >
            新建角色参考
          </Button>
        }
      />

      {!project ? (
        <Panel className="asset-empty">
          <b>尚未选择项目</b>
          <span>选择或创建项目后，才能查看和保存项目角色参考。</span>
        </Panel>
      ) : (
        <>
          <div className="asset-summary">
            <div>
              <span className="asset-summary__mark">
                <UserRound size={17} />
              </span>
              <b>{project.name}</b>
              <Badge>
                {referencesQuery.isLoading
                  ? '读取中'
                  : referencesQuery.isError
                    ? '暂不可用'
                    : `${references.length} 份角色参考`}
              </Badge>
            </div>
            <p>参考记录保存在项目中；创建记录只保存文字规则，不会调用图像模型。</p>
          </div>

          <div className="asset-controls">
            <div className="asset-filters" role="group" aria-label="按角色参考状态筛选">
              {filters.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? 'is-active' : ''}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <small>{counts[value]}</small>
                </button>
              ))}
            </div>
            <label className="asset-search">
              <Search size={15} />
              <input
                aria-label="搜索角色参考"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索角色名称"
              />
            </label>
          </div>

          {referencesQuery.isLoading ? (
            <div className="chapter-empty" role="status">
              正在读取项目角色参考…
            </div>
          ) : referencesQuery.isError ? (
            <Panel className="asset-empty" role="alert">
              <b>无法读取项目角色参考</b>
              <span>{referencesQuery.error.message}</span>
              <Button
                onClick={() => referencesQuery.refetch()}
                disabled={referencesQuery.isFetching}
              >
                {referencesQuery.isFetching ? '正在重试…' : '重试'}
              </Button>
            </Panel>
          ) : visibleReferences.length ? (
            <div className="asset-grid">
              {visibleReferences.map((reference, index) => (
                <CharacterReferenceCard
                  key={reference.id}
                  reference={reference}
                  index={index}
                  onOpen={() => setSelectedReference(reference)}
                />
              ))}
            </div>
          ) : (
            <Panel className="asset-empty">
              <b>{references.length ? '没有匹配的角色参考' : '项目还没有角色参考'}</b>
              <span>
                {references.length
                  ? '调整状态或搜索条件，查看其他角色参考。'
                  : '从已确认的故事与剧本中提取角色，再创建参考草稿。'}
              </span>
              {references.length > 0 && (filter !== 'all' || query) && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  清除筛选
                </button>
              )}
              {references.length === 0 && (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  建立角色参考草稿
                </Button>
              )}
            </Panel>
          )}
        </>
      )}

      <Panel className="asset-provenance">
        <div>
          <UserRound size={16} />
          <span>
            <b>角色参考记录</b>
            <small>保存角色名称、不可变特征、服装规则、状态和版本；图像与镜头引用尚未接入。</small>
          </span>
        </div>
        <Badge>草稿需审阅</Badge>
      </Panel>

      <CharacterReferenceCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={createCharacterDraft}
        isSaving={createReference.isPending}
      />
      <CharacterReferenceDetailsDialog
        reference={selectedReference}
        onClose={() => setSelectedReference(undefined)}
      />
      {toast && (
        <div className="toast" role="status">
          <span className="toast-mark">✓</span>
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
