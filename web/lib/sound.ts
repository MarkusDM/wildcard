export type SfxKind =
  | 'ui-hover'
  | 'ui-click'
  | 'ready'
  | 'card-draw'
  | 'card-flip'
  | 'card-shuffle'
  | 'card-slide'
  | 'chips'
  | 'bet'
  | 'pot-win'
  | 'magic-activate'
  | 'magic-blocked'
  | 'steal'
  | 'shield'
  | 'turn'
  | 'cashout'
  | 'win'
  | 'lose';

export type VoiceCue = 'raise' | 'fold' | 'magic' | 'steal' | 'block' | 'showdown' | 'win' | 'lose';
export type SoundKind = SfxKind | 'deal' | 'magic-cast' | 'buy-spell';

const STORAGE_KEY = 'magicpoker:sound-enabled';
const SOUND_EVENT_NAME = 'magicpoker:sound-setting-changed';

const LEGACY_SFX: Record<Exclude<SoundKind, SfxKind>, SfxKind> = {
  deal: 'card-draw',
  'magic-cast': 'magic-activate',
  'buy-spell': 'magic-activate',
};

const SFX_PATTERNS: Record<
  SfxKind,
  Array<{
    frequency: number;
    duration: number;
    gain: number;
    delay?: number;
    type?: OscillatorType;
    to?: number;
  }>
> = {
  'ui-hover': [{ frequency: 620, duration: 0.045, gain: 0.008, type: 'sine' }],
  'ui-click': [
    { frequency: 440, duration: 0.07, gain: 0.018, type: 'triangle' },
    { frequency: 660, duration: 0.07, gain: 0.012, delay: 0.035, type: 'sine' },
  ],
  ready: [
    { frequency: 392, duration: 0.1, gain: 0.02 },
    { frequency: 523.25, duration: 0.13, gain: 0.024, delay: 0.065 },
  ],
  'card-draw': [
    { frequency: 210, duration: 0.045, gain: 0.012, type: 'square' },
    { frequency: 250, duration: 0.045, gain: 0.01, delay: 0.055, type: 'square' },
    { frequency: 286, duration: 0.045, gain: 0.009, delay: 0.11, type: 'square' },
  ],
  'card-flip': [
    { frequency: 340, to: 520, duration: 0.12, gain: 0.012, type: 'triangle' },
    { frequency: 760, duration: 0.04, gain: 0.007, delay: 0.08, type: 'sine' },
  ],
  'card-shuffle': [
    { frequency: 160, duration: 0.045, gain: 0.01, type: 'square' },
    { frequency: 190, duration: 0.045, gain: 0.011, delay: 0.045, type: 'square' },
    { frequency: 150, duration: 0.045, gain: 0.01, delay: 0.09, type: 'square' },
    { frequency: 220, duration: 0.045, gain: 0.009, delay: 0.135, type: 'square' },
  ],
  'card-slide': [{ frequency: 260, to: 150, duration: 0.16, gain: 0.014, type: 'triangle' }],
  chips: [
    { frequency: 820, duration: 0.05, gain: 0.012, type: 'sine' },
    { frequency: 1040, duration: 0.055, gain: 0.01, delay: 0.055, type: 'sine' },
    { frequency: 680, duration: 0.06, gain: 0.011, delay: 0.1, type: 'triangle' },
  ],
  bet: [
    { frequency: 420, duration: 0.07, gain: 0.015, type: 'triangle' },
    { frequency: 880, duration: 0.055, gain: 0.012, delay: 0.07, type: 'sine' },
  ],
  'pot-win': [
    { frequency: 392, duration: 0.13, gain: 0.024 },
    { frequency: 493.88, duration: 0.15, gain: 0.022, delay: 0.055 },
    { frequency: 587.33, duration: 0.2, gain: 0.024, delay: 0.11 },
  ],
  'magic-activate': [
    { frequency: 480, to: 860, duration: 0.22, gain: 0.02, type: 'triangle' },
    { frequency: 932.33, duration: 0.18, gain: 0.014, delay: 0.05, type: 'sine' },
  ],
  'magic-blocked': [
    { frequency: 240, duration: 0.11, gain: 0.022, type: 'sawtooth' },
    { frequency: 196, duration: 0.15, gain: 0.016, delay: 0.04, type: 'square' },
  ],
  steal: [
    { frequency: 720, to: 420, duration: 0.16, gain: 0.018, type: 'triangle' },
    { frequency: 1080, duration: 0.05, gain: 0.012, delay: 0.15, type: 'sine' },
  ],
  shield: [
    { frequency: 310, to: 620, duration: 0.18, gain: 0.018, type: 'sine' },
    { frequency: 930, duration: 0.22, gain: 0.01, delay: 0.04, type: 'triangle' },
  ],
  turn: [{ frequency: 740, duration: 0.1, gain: 0.014, type: 'sine' }],
  cashout: [
    { frequency: 587.33, duration: 0.1, gain: 0.018 },
    { frequency: 440, duration: 0.18, gain: 0.016, delay: 0.08 },
  ],
  win: [
    { frequency: 523.25, duration: 0.12, gain: 0.018 },
    { frequency: 659.25, duration: 0.16, gain: 0.02, delay: 0.075 },
    { frequency: 783.99, duration: 0.22, gain: 0.018, delay: 0.16 },
  ],
  lose: [{ frequency: 320, to: 220, duration: 0.24, gain: 0.012, type: 'triangle' }],
};

let audioContext: AudioContext | null = null;
let soundEnabledCache: boolean | null = null;

class AudioManager {
  private masterVolume = 1;
  private sfxVolume = 1;
  private voiceVolume = 0.72;
  private voiceCooldownMs = 4200;
  private lastVoiceAt = 0;

  readMuted(): boolean {
    return !ensureEnabledCache();
  }

  setMuted(muted: boolean): void {
    setSoundEnabled(!muted);
  }

  setVolume(input: { master?: number; sfx?: number; voice?: number }): void {
    this.masterVolume = clampVolume(input.master ?? this.masterVolume);
    this.sfxVolume = clampVolume(input.sfx ?? this.sfxVolume);
    this.voiceVolume = clampVolume(input.voice ?? this.voiceVolume);
  }

  async playSfx(kind: SfxKind): Promise<void> {
    if (!ensureEnabledCache()) {
      return;
    }

    const ctx = await getUnlockedAudioContext();
    if (!ctx) {
      return;
    }

    const pattern = SFX_PATTERNS[kind];
    for (const note of pattern) {
      playNote(ctx, {
        ...note,
        gain: note.gain * this.masterVolume * this.sfxVolume,
        startAt: ctx.currentTime + 0.01 + (note.delay ?? 0),
      });
    }
  }

  async playVoice(cue: VoiceCue, input?: { probability?: number; force?: boolean }): Promise<void> {
    if (!ensureEnabledCache()) {
      return;
    }

    const now = Date.now();
    const probability = input?.probability ?? 0.32;
    if (
      !input?.force &&
      (now - this.lastVoiceAt < this.voiceCooldownMs || Math.random() > probability)
    ) {
      return;
    }

    const ctx = await getUnlockedAudioContext();
    if (!ctx) {
      return;
    }

    this.lastVoiceAt = now;
    playSyntheticVoiceCue(ctx, cue, this.masterVolume * this.voiceVolume);
  }
}

export const audioManager = new AudioManager();

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0, value));
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  return audioContext;
}

async function getUnlockedAudioContext(): Promise<AudioContext | null> {
  const ctx = getAudioContext();
  if (!ctx) {
    return null;
  }

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }

  return ctx;
}

function ensureEnabledCache(): boolean {
  if (soundEnabledCache !== null) {
    return soundEnabledCache;
  }

  if (typeof window === 'undefined') {
    soundEnabledCache = true;
    return soundEnabledCache;
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  soundEnabledCache = storedValue === null ? true : storedValue === 'true';
  return soundEnabledCache;
}

function playNote(
  ctx: AudioContext,
  input: {
    frequency: number;
    startAt: number;
    duration: number;
    gain: number;
    type?: OscillatorType;
    to?: number;
  },
) {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = input.type ?? 'triangle';
  oscillator.frequency.setValueAtTime(input.frequency, input.startAt);
  if (input.to) {
    oscillator.frequency.exponentialRampToValueAtTime(input.to, input.startAt + input.duration);
  }

  gainNode.gain.setValueAtTime(0.0001, input.startAt);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, input.gain), input.startAt + 0.018);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, input.startAt + input.duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(input.startAt);
  oscillator.stop(input.startAt + input.duration + 0.04);
}

function playSyntheticVoiceCue(ctx: AudioContext, cue: VoiceCue, volume: number): void {
  const baseByCue: Record<VoiceCue, number> = {
    raise: 165,
    fold: 130,
    magic: 190,
    steal: 175,
    block: 145,
    showdown: 155,
    win: 210,
    lose: 115,
  };
  const contourByCue: Record<VoiceCue, number[]> = {
    raise: [1, 1.16, 1.34],
    fold: [1, 0.9],
    magic: [1, 1.5, 1.18],
    steal: [1.22, 0.96, 1.08],
    block: [0.92, 1.06],
    showdown: [1, 1.12, 0.98],
    win: [1, 1.25, 1.5],
    lose: [1, 0.84, 0.72],
  };
  const base = baseByCue[cue];
  const contour = contourByCue[cue];
  const now = ctx.currentTime + 0.01;

  contour.forEach((step, index) => {
    const startAt = now + index * 0.105;
    playNote(ctx, {
      frequency: base * step,
      startAt,
      duration: 0.13,
      gain: 0.012 * volume,
      type: 'sawtooth',
    });
    playNote(ctx, {
      frequency: base * step * 2.05,
      startAt,
      duration: 0.11,
      gain: 0.0045 * volume,
      type: 'triangle',
    });
  });
}

export function readSoundEnabled(): boolean {
  return ensureEnabledCache();
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabledCache = enabled;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(SOUND_EVENT_NAME, { detail: { enabled } }));
  }
}

export function onSoundEnabledChange(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ enabled?: boolean }>;
    listener(Boolean(customEvent.detail?.enabled));
  };

  window.addEventListener(SOUND_EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(SOUND_EVENT_NAME, handler as EventListener);
}

export function setMuted(muted: boolean): void {
  audioManager.setMuted(muted);
}

export function setVolume(input: { master?: number; sfx?: number; voice?: number }): void {
  audioManager.setVolume(input);
}

export async function playSfx(kind: SfxKind): Promise<void> {
  await audioManager.playSfx(kind);
}

export async function playVoice(
  cue: VoiceCue,
  input?: { probability?: number; force?: boolean },
): Promise<void> {
  await audioManager.playVoice(cue, input);
}

export async function playSound(kind: SoundKind): Promise<void> {
  await playSfx(
    kind in LEGACY_SFX ? LEGACY_SFX[kind as Exclude<SoundKind, SfxKind>] : (kind as SfxKind),
  );
}
