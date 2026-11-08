import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field, SelectInput, TextArea, TextInput } from '../ui/Field';
import type { AdaptationOutlineScene, ScriptDialogue, ScriptScene } from '../../lib/types';

function emptyDialogue(number: number, chapterOrdinals: number[]): ScriptDialogue {
  return {
    dialogue_number: number,
    speaker: '',
    text: '',
    emotion: '克制',
    delivery: '自然说话',
    estimated_seconds: 5,
    source_chapter_ordinals: chapterOrdinals,
    origin: 'adaptation',
  };
}

export function ScriptSceneEditor({
  scene,
  outlineScene,
  onChange,
}: {
  scene: ScriptScene;
  outlineScene: AdaptationOutlineScene;
  onChange: (scene: ScriptScene) => void;
}) {
  const update = (change: Partial<ScriptScene>) => onChange({ ...scene, ...change });
  const allocatedSeconds =
    scene.action_seconds +
    scene.dialogues.reduce((total, dialogue) => total + dialogue.estimated_seconds, 0);
  const updateDialogue = (number: number, change: Partial<ScriptDialogue>) =>
    update({
      dialogues: scene.dialogues.map((line) =>
        line.dialogue_number === number ? { ...line, ...change } : line,
      ),
    });

  return (
    <section className="script-scene-card">
      <header>
        <div>
          <b>
            场次 {scene.scene_number} · {outlineScene.slugline}
          </b>
          <span>
            {outlineScene.location} · {outlineScene.time_of_day} · 来源{' '}
            {outlineScene.source_chapter_ordinals.join('、') || '新增'}
          </span>
        </div>
        <Badge tone={allocatedSeconds > outlineScene.estimated_seconds ? 'red' : 'neutral'}>
          {allocatedSeconds} / {outlineScene.estimated_seconds} 秒
        </Badge>
      </header>
      <Field label="动作与画面（不含镜头指令）">
        <TextArea
          rows={5}
          value={scene.action}
          onChange={(event) => update({ action: event.target.value })}
        />
      </Field>
      <Field label="动作时间预算（秒）">
        <TextInput
          type="number"
          min={0}
          max={outlineScene.estimated_seconds}
          value={scene.action_seconds}
          onChange={(event) => update({ action_seconds: Number(event.target.value) })}
        />
      </Field>
      <div className="script-dialogues-heading">
        <b>对白与旁白（{scene.dialogues.length}）</b>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() =>
            update({
              dialogues: [
                ...scene.dialogues,
                emptyDialogue(scene.dialogues.length + 1, outlineScene.source_chapter_ordinals),
              ],
            })
          }
        >
          添加对白
        </Button>
      </div>
      {!scene.dialogues.length && (
        <p className="muted-copy">本场目前没有对白。可保留为纯动作场，也可添加对白或旁白。</p>
      )}
      {scene.dialogues.map((line) => (
        <article className="script-dialogue-card" key={line.dialogue_number}>
          <div className="script-dialogue-card__heading">
            <b>对白 {line.dialogue_number}</b>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`删除第 ${line.dialogue_number} 条对白`}
              onClick={() =>
                update({
                  dialogues: scene.dialogues
                    .filter((item) => item.dialogue_number !== line.dialogue_number)
                    .map((item, index) => ({ ...item, dialogue_number: index + 1 })),
                })
              }
            >
              <Trash2 size={13} />
            </Button>
          </div>
          <div className="script-dialogue-fields">
            <Field label="说话人">
              <TextInput
                value={line.speaker}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, { speaker: event.target.value })
                }
              />
            </Field>
            <Field label="情绪">
              <TextInput
                value={line.emotion}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, { emotion: event.target.value })
                }
              />
            </Field>
            <Field label="表达方式">
              <TextInput
                value={line.delivery}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, { delivery: event.target.value })
                }
              />
            </Field>
            <Field label="对白时长（秒）">
              <TextInput
                type="number"
                min={1}
                max={180}
                value={line.estimated_seconds}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, {
                    estimated_seconds: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="内容属性">
              <SelectInput
                value={line.origin}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, {
                    origin: event.target.value as ScriptDialogue['origin'],
                  })
                }
              >
                <option value="direct_quote">原文直引（逐字核验）</option>
                <option value="adaptation">基于原文的改编表达</option>
                <option value="original">新增对白/旁白</option>
              </SelectInput>
            </Field>
            <Field label="出处章节（逗号分隔）">
              <TextInput
                value={line.source_chapter_ordinals.join(', ')}
                onChange={(event) =>
                  updateDialogue(line.dialogue_number, {
                    source_chapter_ordinals: event.target.value
                      .split(',')
                      .map((value) => Number(value.trim()))
                      .filter(Number.isInteger),
                  })
                }
              />
            </Field>
          </div>
          <Field label="对白文本">
            <TextArea
              rows={3}
              value={line.text}
              onChange={(event) =>
                updateDialogue(line.dialogue_number, { text: event.target.value })
              }
            />
          </Field>
          {line.origin === 'direct_quote' && (
            <small className="script-quote-hint">
              验收时服务器会在指定锁版章节中逐字查找这条对白；标点或删节也必须与原文一致。
            </small>
          )}
        </article>
      ))}
    </section>
  );
}
