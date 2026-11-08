import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, TextArea, TextInput } from '../ui/Field';
import type { AdaptationOutlineBeat, AdaptationOutlineScene } from '../../lib/types';

export function AdaptationSceneEditor({
  episodeNumber,
  episodeChapterOrdinals,
  episodeSeconds,
  scene,
  canRemove,
  onChange,
  onRemove,
}: {
  episodeNumber: number;
  episodeChapterOrdinals: number[];
  episodeSeconds: number;
  scene: AdaptationOutlineScene;
  canRemove: boolean;
  onChange: (scene: AdaptationOutlineScene) => void;
  onRemove: () => void;
}) {
  const update = (change: Partial<AdaptationOutlineScene>) => onChange({ ...scene, ...change });
  const updateBeat = (beatNumber: number, change: Partial<AdaptationOutlineBeat>) =>
    update({
      beats: scene.beats.map((beat) =>
        beat.beat_number === beatNumber ? { ...beat, ...change } : beat,
      ),
    });

  return (
    <section className="outline-scene-card">
      <header>
        <b>场次 {scene.scene_number}</b>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} />}
          disabled={!canRemove}
          aria-label={`删除第 ${episodeNumber} 集第 ${scene.scene_number} 场`}
          onClick={onRemove}
        >
          删除
        </Button>
      </header>
      <div className="outline-scene-fields">
        <Field label="场景标题">
          <TextInput
            value={scene.slugline}
            onChange={(event) => update({ slugline: event.target.value })}
          />
        </Field>
        <Field label="地点">
          <TextInput
            value={scene.location}
            onChange={(event) => update({ location: event.target.value })}
          />
        </Field>
        <Field label="时段">
          <TextInput
            value={scene.time_of_day}
            onChange={(event) => update({ time_of_day: event.target.value })}
          />
        </Field>
        <Field label="场次时长（秒）">
          <TextInput
            type="number"
            min={1}
            max={episodeSeconds}
            value={scene.estimated_seconds}
            onChange={(event) => update({ estimated_seconds: Number(event.target.value) })}
          />
        </Field>
        <Field label="出场角色（逗号分隔）">
          <TextInput
            value={scene.character_names.join(', ')}
            onChange={(event) =>
              update({
                character_names: event.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field label="来源章节序号（逗号分隔）">
          <TextInput
            value={scene.source_chapter_ordinals.join(', ')}
            onChange={(event) =>
              update({
                source_chapter_ordinals: event.target.value
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter(Number.isInteger),
              })
            }
          />
        </Field>
      </div>
      <div className="outline-scene-fields outline-scene-fields--wide">
        <Field label="场次目的">
          <TextArea
            rows={2}
            value={scene.purpose}
            onChange={(event) => update({ purpose: event.target.value })}
          />
        </Field>
        <Field label="场次冲突">
          <TextArea
            rows={2}
            value={scene.conflict}
            onChange={(event) => update({ conflict: event.target.value })}
          />
        </Field>
      </div>
      <label className="outline-addition-toggle">
        <input
          type="checkbox"
          checked={scene.is_adaptation_addition}
          onChange={(event) =>
            update({
              is_adaptation_addition: event.target.checked,
              source_chapter_ordinals: event.target.checked ? [] : [episodeChapterOrdinals[0]],
            })
          }
        />
        纯新增场次（无原文章节出处）
      </label>
      <div className="outline-beats-heading">
        <b>场内节拍</b>
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() =>
            update({
              beats: [
                ...scene.beats,
                { beat_number: scene.beats.length + 1, action: '', turn: '' },
              ],
            })
          }
        >
          添加节拍
        </Button>
      </div>
      {scene.beats.map((beat) => (
        <div className="outline-beat-row" key={beat.beat_number}>
          <b>{beat.beat_number}</b>
          <Field label="行动">
            <TextInput
              value={beat.action}
              onChange={(event) => updateBeat(beat.beat_number, { action: event.target.value })}
            />
          </Field>
          <Field label="转折或结果">
            <TextInput
              value={beat.turn}
              onChange={(event) => updateBeat(beat.beat_number, { turn: event.target.value })}
            />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            disabled={scene.beats.length <= 2}
            aria-label={`删除第 ${beat.beat_number} 个节拍`}
            onClick={() =>
              update({
                beats: scene.beats
                  .filter((item) => item.beat_number !== beat.beat_number)
                  .map((item, index) => ({ ...item, beat_number: index + 1 })),
              })
            }
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
    </section>
  );
}
