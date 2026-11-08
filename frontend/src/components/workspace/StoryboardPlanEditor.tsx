import { Plus, Trash2 } from 'lucide-react';
import type { ShotPlanRelease } from '../../lib/types';

type Episodes = ShotPlanRelease['episodes'];

const shotSizes = [
  'extreme_wide',
  'wide',
  'medium',
  'close_up',
  'extreme_close_up',
  'over_shoulder',
  'insert',
];
const angles = ['eye_level', 'high_angle', 'low_angle', 'overhead', 'dutch'];
const movements = ['static', 'pan', 'tilt', 'dolly', 'tracking', 'handheld', 'zoom'];

function updateShot(
  episodes: Episodes,
  episodeNumber: number,
  sceneNumber: number,
  shotIndex: number,
  patch: Partial<Episodes[number]['scenes'][number]['shots'][number]>,
): Episodes {
  return episodes.map((episode) =>
    episode.episode_number !== episodeNumber
      ? episode
      : {
          ...episode,
          scenes: episode.scenes.map((scene) =>
            scene.scene_number !== sceneNumber
              ? scene
              : {
                  ...scene,
                  shots: scene.shots.map((shot, index) =>
                    index === shotIndex ? { ...shot, ...patch } : shot,
                  ),
                },
          ),
        },
  );
}

export function StoryboardPlanEditor({
  episodes,
  onChange,
}: {
  episodes: Episodes;
  onChange: (episodes: Episodes) => void;
}) {
  return (
    <div className="shot-plan-editor">
      {episodes.map((episode) => (
        <section key={episode.episode_number} className="shot-plan-episode">
          <h3>第 {episode.episode_number} 集</h3>
          {episode.scenes.map((scene) => (
            <div key={scene.scene_number} className="shot-plan-scene">
              <h4>第 {scene.scene_number} 场</h4>
              {scene.shots.map((shot, index) => (
                <article className="shot-plan-card" key={shot.shot_number}>
                  <header>
                    <b>镜头 {shot.shot_number}</b>
                    <span>{shot.duration_seconds}s</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`删除镜头 ${shot.shot_number}`}
                      disabled={scene.shots.length < 2}
                      onClick={() =>
                        onChange(
                          episodes.map((item) =>
                            item.episode_number !== episode.episode_number
                              ? item
                              : {
                                  ...item,
                                  scenes: item.scenes.map((entry) =>
                                    entry.scene_number !== scene.scene_number
                                      ? entry
                                      : {
                                          ...entry,
                                          shots: entry.shots
                                            .filter((_, i) => i !== index)
                                            .map((value, i) => ({ ...value, shot_number: i + 1 })),
                                        },
                                  ),
                                },
                          ),
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </header>
                  <div className="shot-plan-controls">
                    <label>
                      景别
                      <select
                        value={shot.shot_size}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { shot_size: e.target.value },
                            ),
                          )
                        }
                      >
                        {shotSizes.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      机位
                      <select
                        value={shot.camera_angle}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { camera_angle: e.target.value },
                            ),
                          )
                        }
                      >
                        {angles.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      运镜
                      <select
                        value={shot.camera_movement}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { camera_movement: e.target.value },
                            ),
                          )
                        }
                      >
                        {movements.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      时长（秒）
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={shot.duration_seconds}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { duration_seconds: Number(e.target.value) },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      构图
                      <input
                        value={shot.composition}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { composition: e.target.value },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      可见动作
                      <textarea
                        value={shot.visible_action}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { visible_action: e.target.value },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      角色（逗号分隔）
                      <input
                        value={shot.character_names.join('，')}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              {
                                character_names: e.target.value
                                  .split(/[，,]/)
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      对白编号（逗号分隔）
                      <input
                        value={shot.dialogue_numbers.join(',')}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              {
                                dialogue_numbers: e.target.value
                                  .split(',')
                                  .map(Number)
                                  .filter(Number.isInteger),
                              },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      连续性锚点（逗号分隔）
                      <input
                        value={shot.continuity_anchors.join('，')}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              {
                                continuity_anchors: e.target.value
                                  .split(/[，,]/)
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      画面生成提示词
                      <textarea
                        value={shot.visual_prompt}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { visual_prompt: e.target.value },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      负面提示词
                      <textarea
                        value={shot.negative_prompt}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { negative_prompt: e.target.value },
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      转场
                      <input
                        value={shot.transition}
                        onChange={(e) =>
                          onChange(
                            updateShot(
                              episodes,
                              episode.episode_number,
                              scene.scene_number,
                              index,
                              { transition: e.target.value },
                            ),
                          )
                        }
                      />
                    </label>
                    <div className="shot-plan-source">
                      对白：
                      {shot.dialogue_numbers.length
                        ? shot.dialogue_numbers.map((number) => `#${number}`).join(' · ')
                        : '无'}
                      <br />
                      章节出处：
                      {shot.source_chapter_ordinals.length
                        ? shot.source_chapter_ordinals.join('、')
                        : '原创新增场次'}{' '}
                      · 素材引用：{shot.asset_refs.join('、') || '未指定'}
                    </div>
                  </div>
                </article>
              ))}
              <button
                type="button"
                className="shot-plan-add"
                onClick={() => {
                  const last = scene.shots.at(-1);
                  if (!last) return;
                  const next = {
                    ...last,
                    shot_number: last.shot_number + 1,
                    dialogue_numbers: [],
                    visible_action: '补充该镜头的可见动作',
                    duration_seconds: 1,
                  };
                  onChange(
                    episodes.map((item) =>
                      item.episode_number !== episode.episode_number
                        ? item
                        : {
                            ...item,
                            scenes: item.scenes.map((entry) =>
                              entry.scene_number === scene.scene_number
                                ? { ...entry, shots: [...entry.shots, next] }
                                : entry,
                            ),
                          },
                    ),
                  );
                }}
              >
                <Plus size={15} />
                添加镜头
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
