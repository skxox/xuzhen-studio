import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Image, Plus, Shield, Sparkles, Video, Volume2 } from 'lucide-react';
import type { Project, ServiceProfile } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';

export function SettingsPage({ project }: { project?: Project }) {
  const [modality, setModality] = useState<ServiceProfile['modality']>('text');
  const [name, setName] = useState('');
  const [adapter, setAdapter] = useState('openai-compatible-chat');
  const [transport, setTransport] = useState<'remote_api' | 'self_hosted_api' | 'local_runtime'>(
    'remote_api',
  );
  const [endpoint, setEndpoint] = useState('https://api.example.com/v1');
  const [model, setModel] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [toast, setToast] = useState('');
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const selectModality = (next: ServiceProfile['modality']) => {
    setModality(next);
    setAdapter(
      next === 'text'
        ? 'openai-compatible-chat'
        : next === 'image'
          ? 'openai-compatible-image'
          : next === 'audio'
            ? 'openai-compatible-audio'
            : 'custom',
    );
  };
  const profiles = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const create = useMutation({
    mutationFn: (
      body: Omit<ServiceProfile, 'id' | 'enabled' | 'version'> & {
        capabilities?: Record<string, unknown>;
      },
    ) => api.createServiceProfile(projectId!, body),
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: ['service-profiles', projectId] });
      setName('');
      setModel('');
      setSecretRef('');
      setToast(
        profile.secret_configured
          ? '服务档案已保存；可以检查文本服务连通性。'
          : '服务档案已保存；请在后端环境配置对应密钥引用后再测试。',
      );
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;
    create.mutate({
      modality,
      name: name.trim(),
      adapter_id: adapter,
      transport,
      endpoint,
      model_id: model.trim(),
      secret_ref: secretRef.trim() || undefined,
      capabilities: {},
    });
  };
  return (
    <div className="settings-page">
      <PageHeading
        eyebrow="WORKSPACE CONFIGURATION"
        title="服务由你选择，密钥留在安全边界内。"
        description="项目可以混用不同厂商的文本、图片、视频和语音 API。只有已登记且经过能力校验的服务，才能进入正式生成。"
        actions={<Badge tone="blue">API / 本机服务</Badge>}
      />
      <div className="settings-warning">
        <Shield size={16} />
        <span>
          <b>安全边界：</b>真实 API Key 不进入浏览器或数据库；请在后端环境变量{' '}
          <code>XZ_PROVIDER_SECRETS</code> 中配置密钥引用。当前已接入 OpenAI 兼容文本生成和 OpenAI
          兼容图片生成；视频和语音档案仍需对应 Adapter 后才能执行。
        </span>
      </div>
      <div className="settings-layout">
        <Panel className="profile-form">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">NEW SERVICE PROFILE</div>
              <h3>登记模型服务</h3>
              <p>按模态分别配置；项目/阶段节点可在生成前选择具体档案。</p>
            </div>
            <Plus size={17} />
          </div>
          {!projectId && (
            <div className="inline-notice">先创建服务端项目，才能给它登记 Provider 档案。</div>
          )}
          <div className="modality-choice" role="tablist" aria-label="服务模态">
            {(
              [
                { key: 'text', label: '文本', icon: Sparkles },
                { key: 'image', label: '图片', icon: Image },
                { key: 'video', label: '视频', icon: Video },
                { key: 'audio', label: '语音', icon: Volume2 },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                role="tab"
                aria-selected={modality === key}
                className={modality === key ? 'is-active' : ''}
                onClick={() => selectModality(key)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <form className="profile-fields" onSubmit={submit}>
            <Field label="档案名称">
              <TextInput
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：主创文本模型"
              />
            </Field>
            <div className="form-row">
              <Field label="协议 / Adapter">
                <SelectInput value={adapter} onChange={(event) => setAdapter(event.target.value)}>
                  <option value="openai-compatible-chat">OpenAI-compatible Chat</option>
                  <option value="openai-compatible-image">OpenAI-compatible Image</option>
                  <option value="openai-compatible-audio">OpenAI-compatible Audio</option>
                  <option value="comfyui">ComfyUI</option>
                  <option value="custom">已注册的自定义 Adapter</option>
                </SelectInput>
              </Field>
              <Field label="部署位置">
                <SelectInput
                  value={transport}
                  onChange={(event) => setTransport(event.target.value as typeof transport)}
                >
                  <option value="remote_api">远程 API</option>
                  <option value="self_hosted_api">自建 API</option>
                  <option value="local_runtime">本机运行时</option>
                </SelectInput>
              </Field>
            </div>
            <Field
              label="API Endpoint"
              hint={
                modality === 'image' && adapter === 'openai-compatible-image'
                  ? '填写 OpenAI 兼容 API 根地址（如 /v1）；需提供 /images/generations 与 /models，图片响应需含 b64_json。远程 HTTPS，本机 HTTP 仅允许 loopback。'
                  : '填写 API 根地址；远程服务要求 HTTPS，本机 HTTP 仅允许 loopback。'
              }
            >
              <TextInput
                type="url"
                required
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </Field>
            <Field label="模型 / Workflow ID">
              <TextInput
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={
                  modality === 'text'
                    ? 'model-name'
                    : modality === 'image'
                      ? 'workflow-or-model-id'
                      : modality === 'audio'
                        ? 'tts-or-audio-model'
                        : 'async-video-model'
                }
              />
            </Field>
            <Field
              label="密钥引用（可选）"
              hint="填写安全引用名，如 openai-main；后端从 XZ_PROVIDER_SECRETS 映射读取，不要填写 API Key。"
            >
              <TextInput
                value={secretRef}
                onChange={(event) => setSecretRef(event.target.value)}
                pattern="[A-Za-z][A-Za-z0-9_-]{1,63}"
                placeholder="openai-main"
              />
            </Field>
            {create.isError && (
              <p className="form-error" role="alert">
                保存失败：{create.error.message}
              </p>
            )}
            <Button variant="primary" type="submit" disabled={!projectId || create.isPending}>
              {create.isPending ? '保存中…' : '保存服务档案'}
            </Button>
          </form>
        </Panel>
        <div className="profile-list-column">
          <Panel className="profiles-list">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">REGISTERED PROFILES</div>
                <h3>已登记服务</h3>
                <p>只显示当前选中项目的服务档案。</p>
              </div>
              <Badge>{profiles.data?.length ?? 0} 个</Badge>
            </div>
            {!projectId ? (
              <ProfileEmpty />
            ) : profiles.data?.length ? (
              profiles.data.map((profile) => (
                <ProfileRow key={profile.id} projectId={projectId} profile={profile} />
              ))
            ) : (
              <ProfileEmpty />
            )}
            <div className="provider-empty-note">
              <Cloud size={15} />
              <span>
                文本服务可检查 `/models` 与模型 ID；图片、视频、语音服务需各自的 Adapter
                才能测试和执行。
              </span>
            </div>
          </Panel>
          <Panel className="routing-card">
            <div className="eyebrow">ROUTING PRECEDENCE</div>
            <h3>调用优先级</h3>
            <div className="routing-chain">
              <span>节点覆盖</span>
              <i />
              <span>阶段覆盖</span>
              <i />
              <span>项目默认</span>
              <i />
              <span>工作区默认</span>
            </div>
            <small>
              提交前服务端要展示解析后的最终 Provider、模型、支持参数、授权状态和缺失字段。
            </small>
          </Panel>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-mark">✓</span>
          {toast}
          <button onClick={() => setToast('')} aria-label="关闭">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ projectId, profile }: { projectId: string; profile: ServiceProfile }) {
  const queryClient = useQueryClient();
  const test = useMutation({
    mutationFn: () => api.testServiceProfile(projectId, profile.id),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['service-profiles', projectId] });
    },
  });
  const Icon =
    profile.modality === 'text'
      ? Sparkles
      : profile.modality === 'image'
        ? Image
        : profile.modality === 'audio'
          ? Volume2
          : Video;
  const connected = profile.connection_test?.status === 'connected';
  const supported =
    (profile.modality === 'text' && profile.adapter_id === 'openai-compatible-chat') ||
    (profile.modality === 'image' && profile.adapter_id === 'openai-compatible-image');
  return (
    <div className="profile-row">
      <span className="profile-row__icon">
        <Icon size={16} />
      </span>
      <div>
        <b>{profile.name}</b>
        <small>
          {profile.adapter_id} · {profile.model_id}
        </small>
        <span className="profile-endpoint">{profile.endpoint}</span>
        <small>
          {profile.secret_ref
            ? `密钥引用 ${profile.secret_ref} · ${profile.secret_configured ? '已配置' : '未配置'}`
            : '无需密钥引用'}
        </small>
        {test.isError && <small className="form-error">连通检查失败：{test.error.message}</small>}
      </div>
      <Badge
        tone={connected ? 'green' : profile.connection_test?.status === 'failed' ? 'red' : 'gold'}
        dot
      >
        {connected
          ? '已连通'
          : profile.connection_test?.status === 'failed'
            ? '检查失败'
            : '未检查'}
      </Badge>
      <button
        className="text-link"
        disabled={
          !supported ||
          (!profile.secret_configured && Boolean(profile.secret_ref)) ||
          test.isPending
        }
        title={
          !supported
            ? '当前 Adapter 暂不支持连接检查'
            : !profile.secret_configured && profile.secret_ref
              ? '先配置后端密钥引用'
              : undefined
        }
        onClick={() => test.mutate()}
      >
        {test.isPending ? '检查中…' : '测试'}
      </button>
    </div>
  );
}

function ProfileEmpty() {
  return (
    <div className="profile-empty">
      <span>
        <Cloud size={20} />
      </span>
      <b>还没有服务档案</b>
      <small>连接项目后，可登记文本、图片、视频和语音模型服务。</small>
    </div>
  );
}
