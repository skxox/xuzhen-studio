import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Check, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { PageHeading, Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { Project, ScriptDialogue } from '../lib/types';

type DialogueRef = {
  episode_number: number;
  scene_number: number;
  line: ScriptDialogue;
};
const dialogueKey = (
  line: Pick<DialogueRef, 'episode_number' | 'scene_number'> & { dialogue_number: number },
) => `${line.episode_number}:${line.scene_number}:${line.dialogue_number}`;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function OriginalVoiceWorkspace({ project }: { project?: Project }) {
  const projectId = project?.id;
  const queryClient = useQueryClient();
  const idempotencyKey = useRef('');
  const [profileId, setProfileId] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [responseFormat, setResponseFormat] = useState('mp3');
  const [speed, setSpeed] = useState(1);
  const [consent, setConsent] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [reason, setReason] = useState('');
  const stagesQuery = useQuery({
    queryKey: ['stages', projectId],
    queryFn: () => api.stages(projectId!),
    enabled: Boolean(projectId),
  });
  const scriptsQuery = useQuery({
    queryKey: ['script-releases', projectId],
    queryFn: () => api.scriptReleases(projectId!),
    enabled: Boolean(projectId),
  });
  const candidatesQuery = useQuery({
    queryKey: ['audio-candidates', projectId],
    queryFn: () => api.audioCandidates(projectId!),
    enabled: Boolean(projectId),
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs', projectId],
    queryFn: () => api.jobs(projectId!),
    enabled: Boolean(projectId),
  });
  const profilesQuery = useQuery({
    queryKey: ['service-profiles', projectId],
    queryFn: () => api.serviceProfiles(projectId!),
    enabled: Boolean(projectId),
  });
  const stages = stagesQuery.data ?? [];
  const stage = stages.find((item) => item.stage_key === 'voice');
  const scriptStage = stages.find((item) => item.stage_key === 'script');
  const script = scriptsQuery.data?.find((item) => item.is_current);
  const lines = useMemo<DialogueRef[]>(
    () =>
      script?.episodes.flatMap((episode) =>
        episode.scenes.flatMap((scene) =>
          scene.dialogues.map((line) => ({
            episode_number: episode.episode_number,
            scene_number: scene.scene_number,
            line,
          })),
        ),
      ) ?? [],
    [script],
  );
  const candidates = candidatesQuery.data ?? [];
  const accepted = new Set(
    candidates
      .filter((item) => item.status === 'accepted' && item.script_release_id === script?.id)
      .map(dialogueKey),
  );
  const pending = candidates.find(
    (item) => item.status === 'needs_review' && item.script_release_id === script?.id,
  );
  const focus =
    lines.find(
      (item) =>
        dialogueKey({ ...item, dialogue_number: item.line.dialogue_number }) ===
        (pending ? dialogueKey(pending) : ''),
    ) ??
    lines.find(
      (item) =>
        dialogueKey({ ...item, dialogue_number: item.line.dialogue_number }) === selectedKey,
    ) ??
    lines.find(
      (item) => !accepted.has(dialogueKey({ ...item, dialogue_number: item.line.dialogue_number })),
    ) ??
    lines[0];
  const currentKey = focus
    ? dialogueKey({
        episode_number: focus.episode_number,
        scene_number: focus.scene_number,
        dialogue_number: focus.line.dialogue_number,
      })
    : '';
  const currentCandidate =
    pending ??
    candidates.find(
      (item) =>
        item.script_release_id === script?.id &&
        item.status === 'accepted' &&
        dialogueKey(item) === currentKey,
    );
  const profiles = (profilesQuery.data ?? []).filter(
    (item) =>
      item.modality === 'audio' && item.adapter_id === 'openai-compatible-audio' && item.enabled,
  );
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0];
  const ready = Boolean(script && scriptStage?.status === 'accepted');
  const running = stage?.status === 'running';
  const refresh = async () =>
    Promise.all(
      ['stages', 'jobs', 'audio-candidates'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, projectId] }),
      ),
    );
  const generate = useMutation({
    mutationFn: async () => {
      if (!projectId || !script || !focus || !profile)
        throw new Error('需要当前已验收剧本和可用的语音 API。');
      if (pending) throw new Error('请先审阅当前对白配音候选。');
      if (stage?.status === 'needs_review') throw new Error('请先处理当前等待审阅的配音。');
      const text = focus.line.text;
      const textHash = await sha256(text);
      if (stage?.status !== 'running') await api.startStage(projectId, 'voice');
      idempotencyKey.current = crypto.randomUUID();
      return api.createAudioJob(projectId, {
        stage_key: 'voice',
        profile_id: profile.id,
        idempotency_key: idempotencyKey.current,
        prompt: text,
        parameters: { voice: voice.trim(), response_format: responseFormat, speed },
        input_refs: [script.id, script.job_id],
        scope: {
          script_release_id: script.id,
          episode_number: focus.episode_number,
          scene_number: focus.scene_number,
          dialogue_number: focus.line.dialogue_number,
          base_text_hash: textHash,
        },
        data_authorized: consent,
      });
    },
    onSuccess: async () => {
      setConsent(false);
      await refresh();
    },
    onError: refresh,
  });
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'reject') =>
      api.decideStage(projectId!, 'voice', action, action === 'reject' ? reason.trim() : undefined),
    onSuccess: async () => {
      setReason('');
      setSelectedKey('');
      await refresh();
    },
  });
  const error = generate.error ?? decide.error ?? candidatesQuery.error;
  const failedJob = jobsQuery.data?.find(
    (job) => job.stage_key === 'voice' && job.status === 'failed',
  );
  return (
    <div className="workspace-page">
      <PageHeading
        eyebrow="VOICE · SCRIPT DIALOGUE"
        title="逐句配音生成与审阅"
        description="从当前已验收剧本逐句生成 TTS 候选。可按对白指定音色、语速和格式；逐句验收后才允许生成后期交接包。"
      />
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">SPEECH PROVIDER</span>
            <h2>生成设置</h2>
          </div>
          <Link className="text-link" to="/settings">
            管理语音服务
          </Link>
        </div>
        {!ready && (
          <p>
            先验收当前分集剧本。<Link to="/writing/script">前往剧本</Link>
          </p>
        )}
        {ready && (
          <div className="form-grid">
            <Field label="语音模型">
              <select
                value={profile?.id ?? ''}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="">选择已启用的 OpenAI-compatible Audio 服务</option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.model_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="音色 ID" hint="不同服务商支持的音色不同；请使用该模型提供的 voice ID。">
              <input
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                maxLength={120}
              />
            </Field>
            <Field label="音频格式">
              <select
                value={responseFormat}
                onChange={(event) => setResponseFormat(event.target.value)}
              >
                {['mp3', 'wav', 'opus', 'aac', 'flac'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="语速">
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                {[0.75, 1, 1.25, 1.5, 2].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </Field>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              我确认将当前锁定对白发送给所选语音 API
            </label>
          </div>
        )}
        {error && <p className="form-error">{error.message}</p>}
        {failedJob && (
          <p className="form-error">
            语音任务失败：
            {String(failedJob.error.message ?? failedJob.error.code ?? '请检查服务设置后重试。')}
          </p>
        )}
      </Panel>
      {ready && script && (
        <div className="keyframe-workbench">
          <Panel className="keyframe-shot-list">
            <div className="workspace-section-heading">
              <div>
                <span className="eyebrow">DIALOGUE COVERAGE</span>
                <h2>对白清单</h2>
              </div>
              <span>
                {accepted.size}/{lines.length}
              </span>
            </div>
            {script.episodes.map((episode) => (
              <section key={episode.episode_number}>
                <h3>第 {episode.episode_number} 集</h3>
                {episode.scenes.map((scene) => (
                  <div key={scene.scene_number}>
                    <h4>第 {scene.scene_number} 场</h4>
                    {scene.dialogues.map((line) => {
                      const key = dialogueKey({
                        episode_number: episode.episode_number,
                        scene_number: scene.scene_number,
                        dialogue_number: line.dialogue_number,
                      });
                      const status = candidates.find(
                        (item) => item.script_release_id === script.id && dialogueKey(item) === key,
                      )?.status;
                      return (
                        <button
                          className={`keyframe-shot ${key === currentKey ? 'is-selected' : ''}`}
                          type="button"
                          key={key}
                          onClick={() => setSelectedKey(key)}
                        >
                          <span>
                            {status === 'accepted' ? '✓' : status === 'needs_review' ? '◷' : '○'}
                          </span>
                          <b>
                            {line.speaker} · #{line.dialogue_number}
                          </b>
                          <small>{line.estimated_seconds}s</small>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            ))}
          </Panel>
          <div className="keyframe-detail">
            <Panel>
              <div className="workspace-section-heading">
                <div>
                  <span className="eyebrow">
                    LINE{' '}
                    {focus
                      ? `${focus.episode_number}.${focus.scene_number}.${focus.line.dialogue_number}`
                      : '—'}
                  </span>
                  <h2>{focus?.line.speaker ?? '无对白'}</h2>
                </div>
                <span className="status-pill">
                  {pending ? '等待审阅' : currentCandidate ? '已验收' : '待生成'}
                </span>
              </div>
              {focus && (
                <>
                  <blockquote className="voice-dialogue-text">“{focus.line.text}”</blockquote>
                  <p>
                    情绪：{focus.line.emotion} · 表演：{focus.line.delivery} · 来源：
                    {focus.line.origin}
                  </p>
                  {currentCandidate && (
                    <div className="voice-candidate">
                      <audio controls src={api.audioFileUrl(projectId!, currentCandidate.id)} />
                      <p>
                        音色 {currentCandidate.voice_id} · {currentCandidate.content_type} · SHA{' '}
                        {currentCandidate.sha256.slice(0, 12)}
                      </p>
                    </div>
                  )}
                  <div className="workspace-actions">
                    {!pending && (
                      <Button
                        variant="primary"
                        icon={
                          accepted.has(currentKey) ? (
                            <RefreshCw size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )
                        }
                        disabled={!profile || !consent || running || !voice.trim()}
                        onClick={() => generate.mutate()}
                      >
                        {accepted.has(currentKey) ? '重新生成此句' : '生成对白配音'}
                      </Button>
                    )}
                    {pending && (
                      <>
                        <Field label="退回原因">
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="音色、发音或语气需要调整的地方"
                          />
                        </Field>
                        <Button onClick={() => decide.mutate('reject')} disabled={!reason.trim()}>
                          退回重做
                        </Button>
                        <Button
                          variant="primary"
                          icon={<Check size={16} />}
                          onClick={() => decide.mutate('accept')}
                        >
                          验收此句配音
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </Panel>
          </div>
        </div>
      )}
      <Panel>
        <div className="workspace-section-heading">
          <div>
            <span className="eyebrow">POST GATE</span>
            <h2>后期配音门禁</h2>
          </div>
          <AudioLines size={18} />
        </div>
        <p>
          已验收配音 {accepted.size} / {lines.length} 句；逐句齐备后与已验收视频共同解锁后期交接包。
        </p>
        {stage?.status === 'accepted' && (
          <p className="success-copy">配音完整，可以进入后期交接包。</p>
        )}
      </Panel>
    </div>
  );
}
