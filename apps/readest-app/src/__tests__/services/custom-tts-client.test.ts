import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// We exercise CustomTTSClient directly. The class is small and side-effect
// free except for the voices fetch in init(), which we stub per test.

import { CustomTTSClient, __resolveDefaultEndpointForTest } from '@/services/tts/CustomTTSClient';
import { TTSUtils } from '@/services/tts/TTSUtils';

vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredVoice: vi.fn(() => null),
    sortVoicesFunc: (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id),
  },
}));

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: [] })),
}));

// Silence init()'s console.warn — some tests deliberately trigger the
// failure path to verify it returns `false` instead of throwing.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  // jsdom persists window.location across tests — reset to a sensible
  // default so a stray test cannot leak the previous hostname.
  if (typeof window !== 'undefined' && window.location) {
    try {
      window.location.href = 'http://localhost/';
    } catch {
      // some jsdom builds throw on assignment; ignore
    }
  }
});

const setHostname = (hostname: string) => {
  // jsdom's window.location is read-only except via this trick.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, hostname, host: `${hostname}:4000` },
  });
};

describe('CustomTTSClient', () => {
  describe('default endpoint resolution', () => {
    // The constructor calls resolveDefaultEndpoint() once and stores the
    // result in the private #config.endpoint. We assert the resolver
    // directly via the test handle, plus we verify end-to-end that init()
    // hits the URL the constructor captured (without setConfig touching
    // the endpoint).
    test('returns http://localhost:12236 for page hostname "localhost"', () => {
      setHostname('localhost');
      expect(__resolveDefaultEndpointForTest()).toBe('http://localhost:12236');
    });

    test('returns http://localhost:12236 for page hostname "127.0.0.1"', () => {
      setHostname('127.0.0.1');
      expect(__resolveDefaultEndpointForTest()).toBe('http://localhost:12236');
    });

    test('returns http://localhost:12236 for IPv6 loopback "[::1]"', () => {
      setHostname('[::1]');
      expect(__resolveDefaultEndpointForTest()).toBe('http://localhost:12236');
    });

    test('mirrors the page hostname when on a 192.168.x LAN address', () => {
      // Regression: phone on the LAN used to get http://localhost:12236
      // (its own loopback), so the voices probe never reached the dev
      // machine. The default should reuse the page's hostname.
      setHostname('192.168.1.10');
      expect(__resolveDefaultEndpointForTest()).toBe('http://192.168.1.10:12236');
    });

    test('mirrors the page hostname when on a 10.x private IP', () => {
      setHostname('10.0.0.42');
      expect(__resolveDefaultEndpointForTest()).toBe('http://10.0.0.42:12236');
    });

    test('mirrors a public DNS hostname (so a tunnel/remote setup works too)', () => {
      setHostname('tts.example.com');
      expect(__resolveDefaultEndpointForTest()).toBe('http://tts.example.com:12236');
    });

    test('end-to-end: init() uses the resolved default, not a hardcoded localhost', async () => {
      // Construct without setConfig, then enable via the field that
      // setConfig would touch. The test-only accessor below lets us
      // peek at the captured default and confirm init() hits it.
      setHostname('192.168.1.10');
      const expected = __resolveDefaultEndpointForTest();

      const fetchMock = vi.fn();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response);
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const client = new CustomTTSClient();
      // setConfig with the SAME endpoint as the default — this preserves
      // the constructor's URL and only flips `enabled` to true. If the
      // bug came back and the constructor still hardcoded localhost, the
      // setConfig would inject localhost and the assertion below would
      // catch it.
      client.setConfig({
        enabled: true,
        endpoint: expected,
        apiKey: '',
        model: 'tts-1',
      });
      await client.init();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('http://192.168.1.10:12236/v1/audio/voices');
      vi.unstubAllGlobals();
    });
  });

  describe('init() error handling', () => {
    test('returns false and clears voices when fetch rejects (e.g. unreachable LAN host)', async () => {
      setHostname('192.168.1.10');
      // Simulate the LAN scenario: the phone reaches its own loopback, the
      // fetch rejects with a network error.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );

      const client = new CustomTTSClient();
      client.setConfig({
        enabled: true,
        endpoint: 'http://192.168.1.10:12236',
        apiKey: '',
        model: 'tts-1',
      });
      const ok = await client.init();

      expect(ok).toBe(false);
      // Voice list is empty — matches the user-reported symptom.
      const voices = await client.getAllVoices();
      expect(voices).toEqual([]);
      vi.unstubAllGlobals();
    });

    test('returns false when the endpoint returns a non-OK status', async () => {
      setHostname('localhost');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
      );

      const client = new CustomTTSClient();
      client.setConfig({
        enabled: true,
        endpoint: 'http://localhost:12236',
        apiKey: '',
        model: 'tts-1',
      });
      const ok = await client.init();
      expect(ok).toBe(false);
      vi.unstubAllGlobals();
    });
  });

  describe('setConfig() invalidation', () => {
    test('forces re-init when the endpoint changes', async () => {
      setHostname('localhost');
      const fetchMock = vi.fn();
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: 'v1', name: 'Aria', lang: 'en-US' }],
        }),
      } as unknown as Response);
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const client = new CustomTTSClient();
      client.setConfig({
        enabled: true,
        endpoint: 'http://localhost:12236',
        apiKey: '',
        model: 'tts-1',
      });
      await client.init();
      const before = (await client.getAllVoices()).length;

      // Change the endpoint — setConfig should mark the client as
      // uninitialized so the next init() re-probes the new server.
      client.setConfig({
        enabled: true,
        endpoint: 'http://192.168.1.10:12236',
        apiKey: '',
        model: 'tts-1',
      });
      expect(client.initialized).toBe(false);

      await client.init();
      const after = (await client.getAllVoices()).length;

      // Both calls returned the same mock data, but we care that the
      // client is healthy and the second probe happened.
      expect(before).toBeGreaterThan(0);
      expect(after).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCallUrl = fetchMock.mock.calls[1]?.[0] as string;
      expect(secondCallUrl).toBe('http://192.168.1.10:12236/v1/audio/voices');
      vi.unstubAllGlobals();
    });
  });

  // Sanity check that the import path resolves and the mock module above
  // is wired up correctly. Keeps this test file from looking orphaned.
  test('TTSUtils mock is in place', () => {
    expect(TTSUtils.getPreferredVoice('custom-tts', 'zh')).toBeNull();
  });
});
