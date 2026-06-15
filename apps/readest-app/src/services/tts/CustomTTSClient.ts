import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';
import { TTSController } from './TTSController';
import { TTSUtils } from './TTSUtils';
import { parseSSMLMarks } from '@/utils/ssml';
import { LRUCache } from '@/utils/lru';
import { CustomTTSSettings } from '@/types/settings';

interface CustomTTSVoiceResponse {
  id: string;
  name: string;
  owned_by?: string;
  type?: string;
  description?: string;
}

const DEFAULT_CUSTOM_TTS_BASE_URL = 'http://localhost:12236';

/**
 * Pick a sensible default endpoint for the device the page is running on.
 *
 * The hardcoded `http://localhost:12236` only works when the browser and
 * the TTS service run on the same machine. When the app is opened on a
 * phone or another LAN device (e.g. `http://192.168.1.10:4000`), the
 * phone's loopback points to itself, not the dev machine, so the
 * `/v1/audio/voices` probe silently fails and the voice list is empty.
 *
 * When we have a real window location whose hostname is not a loopback
 * address, reuse that hostname and the default port so the request
 * targets the same host that is serving the app.
 */
const resolveDefaultEndpoint = (): string => {
  // Always return the canonical loopback default. The LAN/Docker hostname
  // rewriting is handled in #baseUrl() at request time so that a user-
  // configured endpoint (e.g. https://tts.example.com) is never mangled
  // by the constructor default, and the default is only rewritten when
  // the page is accessed from a LAN IP (not a domain name).
  return DEFAULT_CUSTOM_TTS_BASE_URL;
};

/**
 * Test-only handle on the default-endpoint resolver. Exported so unit
 * tests can assert the LAN-hostname behavior without poking private
 * fields. Not part of the public API — used by
 * `__tests__/services/custom-tts-client.test.ts` only.
 */
export const __resolveDefaultEndpointForTest = resolveDefaultEndpoint;

export class CustomTTSClient implements TTSClient {
  name = 'custom-tts';
  initialized = false;
  controller?: TTSController;

  #config: CustomTTSSettings = {
    enabled: false,
    endpoint: resolveDefaultEndpoint(),
    apiKey: '',
    model: 'tts-1',
  };
  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;

  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  #pausedAt = 0;
  #startedAt = 0;

  private static audioCache = new LRUCache<string, Blob>(200);
  private static audioUrlCache = new LRUCache<string, string>(200, (_, url) => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  });

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  /**
   * Apply the latest user-defined config. Callers (the TTS panel) should
   * invoke this whenever the endpoint/key/model change so subsequent
   * fetches target the right server. The next `init()` call re-queries the
   * new endpoint for voices.
   */
  setConfig(config: CustomTTSSettings) {
    const enabledChanged = this.#config.enabled !== config.enabled;
    const endpointChanged = this.#config.endpoint !== config.endpoint;
    this.#config = { ...config };
    if (enabledChanged || endpointChanged) {
      // The active set of voices is no longer valid; force a re-init
      // before any user-visible action.
      this.initialized = false;
      this.#voices = [];
    }
  }

  #baseUrl(): string {
    const raw = (this.#config.endpoint || resolveDefaultEndpoint()).replace(/\/+$/, '');
    // When the endpoint still points at loopback (the default
    // `http://localhost:12236`) but the page is served from a non-loopback
    // host, the browser's `localhost` resolves to the client device's own
    // loopback — which is not the host running the TTS service.
    //
    // We used to rewrite the hostname to `window.location.hostname`, but
    // that breaks when the page is accessed via a domain name or reverse
    // proxy (the TTS service is not at `domain:12236`) and also triggers
    // mixed-content blocking when the page is HTTPS but the rewritten URL
    // is HTTP.
    //
    // Instead, detect LAN IP access (non-loopback, non-domain) and rewrite
    // to the page hostname only in that case — the TTS service running on
    // the same LAN host can be reached that way. For domain-name access,
    // leave the endpoint as-is and let the fetch fail with a clear console
    // warning so the user knows to configure the endpoint manually.
    if (typeof window === 'undefined' || !window.location?.hostname) return raw;
    const pageHost = window.location.hostname;
    const isLoopback = (h: string) =>
      h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
    if (isLoopback(pageHost)) return raw;
    try {
      const url = new URL(raw);
      if (isLoopback(url.hostname)) {
        // Only rewrite the loopback endpoint to the page hostname when the
        // page is accessed via a LAN IP (not a domain name). Domain access
        // means there's a reverse proxy in front — the TTS service is not
        // at `domain:12236`.
        const isLanIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(pageHost);
        if (isLanIP) {
          url.hostname = pageHost;
          return url.toString().replace(/\/+$/, '');
        }
        // Domain access with default loopback endpoint — the user needs to
        // configure the endpoint manually. Log a clear message and return
        // the raw value so the fetch fails visibly.
        console.warn(
          `[CustomTTS] Endpoint "${raw}" is unreachable from this domain. ` +
            `Please configure the Custom TTS endpoint in Settings → TTS → Custom TTS.`,
        );
      }
    } catch {
      // raw is not a valid URL — fall through and let fetch() report it.
    }
    return raw;
  }

  #authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.#config.apiKey) {
      headers['Authorization'] = `Bearer ${this.#config.apiKey}`;
    }
    return headers;
  }

  async init() {
    if (!this.#config.enabled) {
      this.initialized = false;
      this.#voices = [];
      return false;
    }
    if (!this.#config.endpoint) {
      this.initialized = false;
      this.#voices = [];
      return false;
    }
    try {
      const response = await fetch(`${this.#baseUrl()}/v1/audio/voices`, {
        signal: AbortSignal.timeout(3000),
        headers: this.#authHeaders(),
      });
      if (!response.ok) {
        // Surface the status so the user (or a dev reading the console)
        // can tell apart "wrong endpoint" from "endpoint up but no
        // /v1/audio/voices route".
        console.warn(`[CustomTTS] ${this.#baseUrl()}/v1/audio/voices returned ${response.status}`);
        this.initialized = false;
        this.#voices = [];
        return false;
      }
      const data = (await response.json()) as {
        data: CustomTTSVoiceResponse[];
      };
      this.#voices = (data.data || []).map((v) => ({
        id: v.name,
        name: v.name,
        lang: 'zh',
      }));
      if (this.#voices.length > 0) {
        this.#currentVoiceId = this.#voices[0]!.id;
      }
      this.initialized = true;
    } catch (err) {
      // Most common cause on LAN: the endpoint hostname points to the
      // current device's loopback, not the host running the TTS service.
      // Log the actual error so the user can see it in DevTools instead
      // of a silently empty voice list.
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[CustomTTS] Failed to reach ${this.#baseUrl()}/v1/audio/voices — ${reason}. ` +
          `If you opened Readest on another device, set the endpoint to the host's LAN IP.`,
      );
      this.initialized = false;
      this.#voices = [];
    }
    return this.initialized;
  }

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        const voiceId = await this.getVoiceIdFromLang(mark.language);
        this.#currentVoiceId = voiceId;
        try {
          await this.#createAudioUrl(mark.text, voiceId, signal);
        } catch (err) {
          console.warn('Error preloading mark', i, err);
        }
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            const mark = marks[i]!;
            try {
              if (signal.aborted) break;
              const voiceId = await this.getVoiceIdFromLang(mark.language);
              await this.#createAudioUrl(mark.text, voiceId, signal);
            } catch (err) {
              console.warn('Error preloading mark (bg)', i, err);
            }
          }
        })();
      }

      yield { code: 'end', message: 'Preload finished' } as TTSMessageEvent;
      return;
    }

    await this.stopInternal();
    if (!this.#audioElement) {
      this.#audioElement = new Audio();
    }
    const audio = this.#audioElement;
    audio.setAttribute('x-webkit-airplay', 'deny');
    audio.preload = 'auto';

    for (const mark of marks) {
      this.controller?.dispatchSpeakMark(mark);
      let abortHandler: null | (() => void) = null;
      try {
        const voiceId = await this.getVoiceIdFromLang(mark.language);
        this.#speakingLang = mark.language;
        const audioUrl = await this.#createAudioUrl(mark.text, voiceId, signal);
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            audio.src = '';
          };
          let resolved = false;
          const handleEnded = () => {
            if (resolved) return;
            resolved = true;
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };

          abortHandler = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
          };
          if (signal.aborted) {
            abortHandler();
            return;
          } else {
            signal.addEventListener('abort', abortHandler);
          }
          audio.onended = handleEnded;
          audio.onerror = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Audio playback error' });
          };
          this.#isPlaying = true;
          audio.src = audioUrl || '';
          audio.playbackRate = this.#rate;
          audio.play().catch((err) => {
            cleanUp();
            console.error('Failed to play audio:', err);
            resolve({ code: 'error', message: 'Playback failed: ' + err.message });
          });
        });
        yield result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Custom TTS error for mark:', mark.text, message);
        yield { code: 'error', message } as TTSMessageEvent;
        break;
      } finally {
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    await this.stopInternal();
  }

  async pause() {
    if (!this.#isPlaying || !this.#audioElement) return true;
    this.#pausedAt = this.#audioElement.currentTime - this.#startedAt;
    await this.#audioElement.pause();
    this.#isPlaying = false;
    return true;
  }

  async resume() {
    if (this.#isPlaying || !this.#audioElement) return true;
    await this.#audioElement.play();
    this.#isPlaying = true;
    this.#startedAt = this.#audioElement.currentTime - this.#pausedAt;
    return true;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#isPlaying = false;
    this.#pausedAt = 0;
    this.#startedAt = 0;
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.currentTime = 0;
      if (this.#audioElement?.onended) {
        this.#audioElement.onended(new Event('stopped'));
      }
      this.#audioElement.src = '';
    }
  }

  async setRate(rate: number) {
    this.#rate = rate;
  }

  async setPitch(_pitch: number) {
    // Not supported by OpenAI-compatible TTS API
  }

  async setVoice(voice: string) {
    const selectedVoice = this.#voices.find((v) => v.id === voice);
    if (selectedVoice) {
      this.#currentVoiceId = selectedVoice.id;
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    this.#voices.forEach((voice) => {
      voice.disabled = !this.initialized;
    });
    return this.#voices;
  }

  async getVoices(_lang: string) {
    const voices = await this.getAllVoices();
    const voicesGroup: TTSVoicesGroup = {
      id: 'custom-tts',
      name: 'Custom TTS',
      voices: voices.sort(TTSUtils.sortVoicesFunc),
      disabled: !this.initialized || voices.length === 0,
    };
    return [voicesGroup];
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    await this.stopInternal();
    this.#audioElement = null;
    this.#voices = [];
  }

  getVoiceIdFromLang = async (_lang: string) => {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, 'zh');
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    if (preferredVoice) return preferredVoice.id;
    return this.#currentVoiceId || this.#voices[0]?.id || '';
  };

  #createAudioUrl = async (
    text: string,
    voice: string,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    const cacheKey = `${voice}:${text}:${this.#rate}:${this.#baseUrl()}`;
    if (CustomTTSClient.audioUrlCache.has(cacheKey)) {
      return CustomTTSClient.audioUrlCache.get(cacheKey)!;
    }
    if (signal.aborted) return undefined;

    try {
      const response = await fetch(`${this.#baseUrl()}/v1/audio/speech`, {
        method: 'POST',
        headers: this.#authHeaders(),
        body: JSON.stringify({
          input: text,
          voice,
          model: this.#config.model || undefined,
          speed: this.#rate,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Custom TTS request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      CustomTTSClient.audioCache.set(cacheKey, blob);
      CustomTTSClient.audioUrlCache.set(cacheKey, objectUrl);
      return objectUrl;
    } catch (err) {
      if (signal.aborted) return undefined;
      throw err;
    }
  };

  supportsWordBoundaries(): boolean {
    return false;
  }
}
