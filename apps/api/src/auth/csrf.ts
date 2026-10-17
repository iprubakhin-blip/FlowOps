import { CSRF_HEADER, CSRF_HEADER_VALUE } from './auth.constants';
import { trustedWebOrigins } from './auth.config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfRequest {
  method: string;
  origin?: string;
  secFetchSite?: string;
  requestedWith?: string;
}

export function csrfDecision(request: CsrfRequest, trustedOrigins = trustedWebOrigins()): 'allow' | 'deny' {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return 'allow';
  if (request.requestedWith !== CSRF_HEADER_VALUE) return 'deny';
  if (request.origin && !trustedOrigins.includes(request.origin)) return 'deny';
  if (request.secFetchSite === 'cross-site') return 'deny';
  return 'allow';
}

export function csrfFromHeaders(method: string, headers: Record<string, unknown>): CsrfRequest {
  const header = (name: string): string | undefined => {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    method,
    origin: header('origin'),
    secFetchSite: header('sec-fetch-site'),
    requestedWith: header(CSRF_HEADER),
  };
}
