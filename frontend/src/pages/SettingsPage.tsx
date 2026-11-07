import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, ExternalLink, Image, KeyRound, Plus, Shield, Sparkles, Video } from 'lucide-react';
import type { Project, ServiceProfile } from '../lib/types';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Field, SelectInput, TextInput } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';

export function SettingsPage({ project }: { project?: Project }) {
  const [modality, setModality] = useState<'text'|'image'|'video'>('text');
  const [name, setName] = useState('');
  const [adapter, setAdapter] = useState('openai-compatible-chat');
  const [transport, setTransport] = useState<'remote_api'|'self_hosted_api'|'local_runtime'>('remote_api');
  const [endpoint, setEndpoint] = useState('https://api.example.com/v1');
  const [model, setModel] = useState('');
  const [toast, setToast] = useState('');
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const profiles = useQuery({ queryKey: ['service-profiles', projectId], queryFn: () => api.serviceProfiles(projectId!), enabled: Boolean(projectId) });
  const create = useMutation({ mutationFn: (body: Omit<ServiceProfile, 'id' | 'enabled' | 'version'> & { capabilities?: Record<string, unknown> }) => api.createServiceProfile(projectId!, body), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['service-profiles', projectId] }); setName(''); setModel(''); setToast('服务档案已保存。适配器尚未接入前不可执行生成任务。'); } });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;
    create.mutate({ modality, name: name.trim(), adapter_id: adapter, transport, endpoint, model_id: model.trim(), capabilities: {} });
  };
  return <div className="settings-page"><PageHeading eyebrow="WORKSPACE CONFIGURATION" title="服务由你选择，密钥留在安全边界内。" description="项目可以混用不同厂商的文本、图片和视频 API。只有已登记且经过能力校验的服务，才能进入正式生成。" actions={<Badge tone="blue">API / 本机服务</Badge>} />
    <div className="settings-warning"><Shield size={16}/><span><b>安全边界：</b>当前服务端没有密钥库，也没有连通测试端点。这里仅能保存服务配置元数据；请勿把真实 API Key 填入任何浏览器输入框。</span></div>
    <div className="settings-layout"><Panel className="profile-form"><div className="panel-heading"><div><div className="eyebrow">NEW SERVICE PROFILE</div><h3>登记模型服务</h3><p>按模态分别配置；项目/阶段节点可在生成前选择具体档案。</p></div><Plus size={17}/></div>
      {!projectId && <div className="inline-notice">先创建服务端项目，才能给它登记 Provider 档案。</div>}
      <div className="modality-choice" role="tablist" aria-label="服务模态">{([{key:'text',label:'文本',icon:Sparkles},{key:'image',label:'图片',icon:Image},{key:'video',label:'视频',icon:Video}] as const).map(({key,label,icon:Icon})=><button key={key} role="tab" aria-selected={modality===key} className={modality===key?'is-active':''} onClick={()=>setModality(key)}><Icon size={15}/>{label}</button>)}</div>
      <form className="profile-fields" onSubmit={submit}><Field label="档案名称"><TextInput required value={name} onChange={(event)=>setName(event.target.value)} placeholder="例如：主创文本模型"/></Field>
        <div className="form-row"><Field label="协议 / Adapter"><SelectInput value={adapter} onChange={(event)=>setAdapter(event.target.value)}><option value="openai-compatible-chat">OpenAI-compatible Chat</option><option value="comfyui">ComfyUI</option><option value="custom">已注册的自定义 Adapter</option></SelectInput></Field><Field label="部署位置"><SelectInput value={transport} onChange={(event)=>setTransport(event.target.value as typeof transport)}><option value="remote_api">远程 API</option><option value="self_hosted_api">自建 API</option><option value="local_runtime">本机运行时</option></SelectInput></Field></div>
        <Field label="API Endpoint" hint="远程服务要求 HTTPS；本机 HTTP 仅允许 loopback。"><TextInput type="url" required value={endpoint} onChange={(event)=>setEndpoint(event.target.value)} placeholder="https://api.example.com/v1"/></Field>
        <Field label="模型 / Workflow ID"><TextInput required value={model} onChange={(event)=>setModel(event.target.value)} placeholder={modality==='text'?'model-name':modality==='image'?'workflow-or-model-id':'async-video-model'}/></Field>
        <div className="secret-reference"><KeyRound size={15}/><span><b>密钥引用</b><small>请由部署环境密钥库配置 secret_ref；当前尚无 UI 密钥写入能力。</small></span><Badge tone="gold">未配置</Badge></div>
        {create.isError && <p className="form-error" role="alert">保存失败：{create.error.message}</p>}
        <Button variant="primary" type="submit" disabled={!projectId || create.isPending}>{create.isPending?'保存中…':'保存服务档案'}</Button>
      </form>
    </Panel>
    <div className="profile-list-column"><Panel className="profiles-list"><div className="panel-heading"><div><div className="eyebrow">REGISTERED PROFILES</div><h3>已登记服务</h3><p>只显示当前选中项目的服务档案。</p></div><Badge>{profiles.data?.length ?? 0} 个</Badge></div>
      {!projectId ? <ProfileEmpty/> : profiles.data?.length ? profiles.data.map((profile)=><ProfileRow key={profile.id} profile={profile}/>) : <ProfileEmpty/>}
      <div className="provider-empty-note"><Cloud size={15}/><span>连通测试、能力发现与密钥保险库将在 Provider Adapter 里程碑接入。</span></div>
    </Panel><Panel className="routing-card"><div className="eyebrow">ROUTING PRECEDENCE</div><h3>调用优先级</h3><div className="routing-chain"><span>节点覆盖</span><i/><span>阶段覆盖</span><i/><span>项目默认</span><i/><span>工作区默认</span></div><small>提交前服务端要展示解析后的最终 Provider、模型、支持参数、授权状态和缺失字段。</small></Panel></div>
    </div>
    {toast&&<div className="toast" role="status"><span className="toast-mark">✓</span>{toast}<button onClick={()=>setToast('')} aria-label="关闭">×</button></div>}
  </div>;
}

function ProfileRow({profile}:{profile:ServiceProfile}){
  const Icon=profile.modality==='text'?Sparkles:profile.modality==='image'?Image:Video;
  return <div className="profile-row"><span className="profile-row__icon"><Icon size={16}/></span><div><b>{profile.name}</b><small>{profile.adapter_id} · {profile.model_id}</small><span className="profile-endpoint">{profile.endpoint}</span></div><Badge tone={profile.enabled?'green':'gold'} dot>{profile.enabled?'可用':'未验证'}</Badge><button className="plain-icon" aria-label="服务档案选项"><ExternalLink size={14}/></button></div>;
}

function ProfileEmpty(){return <div className="profile-empty"><span><Cloud size={20}/></span><b>还没有服务档案</b><small>连接项目后，从左侧添加文本、图片或视频模型服务。</small></div>;}
