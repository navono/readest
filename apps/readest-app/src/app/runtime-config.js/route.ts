import { NextRequest, NextResponse } from 'next/server';
import { getServerRuntimeConfig } from '@/services/runtimeConfig';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const config = getServerRuntimeConfig();

  const host = request.headers.get('host') || 'localhost:4000';
  // 提取请求来源的 hostname（localhost 或 127.0.0.1），
  // 用于替换配置 URL 中的外部 IP，避免 WSL2 NAT 隔离导致超时。
  // 必须保持与请求来源相同的 hostname，否则浏览器会因 CORS 拒绝跨域请求
  // （localhost ≠ 127.0.0.1）。
  const localhostHostname = host.split(':')[0] || 'localhost';
  const isLocalhost = localhostHostname === 'localhost' || localhostHostname === '127.0.0.1';

  if (isLocalhost) {
    for (const key of ['supabaseUrl', 'apiBaseUrl'] as const) {
      const url = config[key];
      if (url) {
        try {
          const parsed = new URL(url);
          const isExternalIP = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
          if (isExternalIP && parsed.hostname !== '127.0.0.1') {
            parsed.hostname = localhostHostname;
            config[key] = parsed.toString();
          }
        } catch {
          // 忽略无效 URL
        }
      }
    }
  }

  const serializedConfig = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const script = `window.__READEST_RUNTIME_CONFIG=${serializedConfig};`;
  return new NextResponse(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
