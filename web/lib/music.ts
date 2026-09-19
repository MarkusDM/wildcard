import { onSoundEnabledChange, readSoundEnabled } from './sound';

type MusicScene = 'lobby' | 'table';

const MUSIC_TRACKS: Record<MusicScene, string[]> = {
  lobby: ['/audio/lobby-theme.mp3'],
  table: ['/audio/game1.mp3', '/audio/game2.mp3', '/audio/game3.mp3', '/audio/game4.mp3'],
};

let audio: HTMLAudioElement | null = null;
let activeScene: MusicScene | null = null;
let lastTrackIndexByScene: Partial<Record<MusicScene, number>> = {};
let detachUnlockListeners: (() => void) | null = null;
let detachSoundListener: (() => void) | null = null;

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 0.26;
  }

  if (!detachSoundListener) {
    detachSoundListener = onSoundEnabledChange((enabled) => {
      if (!audio) return;
      if (!enabled) {
        audio.pause();
        return;
      }
      void attemptPlay();
    });
  }

  return audio;
}

function pickTrackIndex(scene: MusicScene): number {
  const tracks = MUSIC_TRACKS[scene];
  if (tracks.length <= 1) {
    lastTrackIndexByScene[scene] = 0;
    return 0;
  }

  let nextIndex = Math.floor(Math.random() * tracks.length);
  if (nextIndex === (lastTrackIndexByScene[scene] ?? -1)) {
    nextIndex = (nextIndex + 1) % tracks.length;
  }
  lastTrackIndexByScene[scene] = nextIndex;
  return nextIndex;
}

function clearUnlockListeners(): void {
  if (detachUnlockListeners) {
    detachUnlockListeners();
    detachUnlockListeners = null;
  }
}

function registerUnlockListeners(): void {
  if (typeof window === 'undefined' || detachUnlockListeners) {
    return;
  }

  const retry = () => {
    clearUnlockListeners();
    void attemptPlay();
  };

  window.addEventListener('pointerdown', retry, { once: true });
  window.addEventListener('keydown', retry, { once: true });
  detachUnlockListeners = () => {
    window.removeEventListener('pointerdown', retry);
    window.removeEventListener('keydown', retry);
  };
}

async function attemptPlay(): Promise<boolean> {
  if (!audio || !activeScene || !readSoundEnabled()) {
    return false;
  }

  try {
    audio.muted = false;
    audio.volume = 0.34;
    await audio.play();
    clearUnlockListeners();
    return true;
  } catch {
    registerUnlockListeners();
    return false;
  }
}

function assignTrack(scene: MusicScene): void {
  if (!audio) return;
  const tracks = MUSIC_TRACKS[scene];
  const trackIndex = scene === 'lobby' ? 0 : pickTrackIndex(scene);
  const nextSrc = tracks[trackIndex] ?? tracks[0];
  if (!nextSrc) return;

  if (audio.dataset.scene === scene && audio.dataset.src === nextSrc) {
    return;
  }

  audio.pause();
  audio.src = nextSrc;
  audio.dataset.scene = scene;
  audio.dataset.src = nextSrc;
  audio.currentTime = 0;
  audio.load();
}

export function startBackgroundMusic(scene: MusicScene): void {
  const element = ensureAudio();
  if (!element) {
    return;
  }

  activeScene = scene;
  assignTrack(scene);

  element.onended = () => {
    if (!audio || activeScene !== 'table') {
      return;
    }
    assignTrack('table');
    void attemptPlay();
  };
  element.loop = scene === 'lobby';

  if (!readSoundEnabled()) {
    element.pause();
    return;
  }

  void attemptPlay();
}

export async function resumeBackgroundMusic(scene?: MusicScene): Promise<boolean> {
  const element = ensureAudio();
  if (!element) {
    return false;
  }

  const nextScene = scene ?? activeScene;
  if (!nextScene) {
    return false;
  }

  activeScene = nextScene;
  assignTrack(nextScene);
  element.loop = nextScene === 'lobby';

  return attemptPlay();
}

export function stopBackgroundMusic(): void {
  activeScene = null;
  clearUnlockListeners();
  if (!audio) {
    return;
  }
  audio.pause();
  audio.currentTime = 0;
  audio.onended = null;
}
