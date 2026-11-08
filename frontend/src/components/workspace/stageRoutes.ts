export function stageRoute(stageKey: string) {
  const routes: Record<string, string> = {
    source: '/source',
    creativeBrief: '/source',
    commercialBrief: '/source',
    storyBible: '/writing',
    novelOutline: '/writing',
    literaryCharacters: '/writing/characters',
    novelDraft: '/writing/chapters',
    continuity: '/writing/continuity',
    manuscriptRelease: '/writing/chapters',
    outline: '/writing/adaptation-outline',
    characters: '/writing',
    art: '/writing',
    script: '/writing/script',
    voice: '/writing/voice',
    shotDesign: '/writing/storyboard',
    keyframes: '/writing/keyframes',
    video: '/writing/video',
    post: '/delivery',
    delivery: '/delivery',
  };
  return routes[stageKey] ?? '/canvas';
}
