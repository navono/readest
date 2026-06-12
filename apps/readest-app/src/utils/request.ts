import type { NextApiRequest } from 'next';

/** Check whether an API request originates from localhost (WSL2 NAT bypass). */
export const isLocalhostRequest = (req: NextApiRequest): boolean => {
  const host = req.headers['host'] || '';
  const hostname = typeof host === 'string' ? host.split(':')[0] : '';
  return hostname === 'localhost' || hostname === '127.0.0.1';
};

/** Extract the hostname from the request's Host header.
 *  Used to build presigned URLs that match the browser's origin (avoids CORS). */
export const getRequestHostname = (req: NextApiRequest): string | undefined => {
  const host = req.headers['host'] || '';
  const hostname = typeof host === 'string' ? host.split(':')[0] : '';
  return hostname || undefined;
};
