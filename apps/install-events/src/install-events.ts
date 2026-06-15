import { randomUUID } from 'node:crypto';

type ApiGatewayEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
  rawPath?: string;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

type ApiResponse = {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
};

type InstallEventStatus = 'failed' | 'started' | 'succeeded';

type InstallEvent = {
  arch?: string;
  durationMs?: number;
  errorKind?: string;
  installId?: string;
  installer?: string;
  platform?: string;
  source?: string;
  status: InstallEventStatus;
  version?: string;
};

const responseHeaders = {
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  'content-type': 'application/json'
};

const statusValues = new Set<InstallEventStatus>(['failed', 'started', 'succeeded']);
const safeStringPattern = /^[ A-Za-z0-9._:/-]+$/;

const jsonResponse = (statusCode: number, body: unknown): ApiResponse => ({
  body: JSON.stringify(body),
  headers: responseHeaders,
  statusCode
});

const asSafeString = (value: unknown, maxLength = 128) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maxLength || !safeStringPattern.test(value)) {
    return undefined;
  }
  return value;
};

const parseInstallEvent = (body: unknown): InstallEvent | undefined => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const input = body as Record<string, unknown>;
  const status = input.status;
  if (typeof status !== 'string' || !statusValues.has(status as InstallEventStatus)) {
    return undefined;
  }

  const durationMs = input.durationMs;
  if (durationMs !== undefined && (typeof durationMs !== 'number' || durationMs < 0 || durationMs > 60 * 60 * 1000)) {
    return undefined;
  }

  return {
    arch: asSafeString(input.arch, 32),
    durationMs,
    errorKind: asSafeString(input.errorKind, 64),
    installId: asSafeString(input.installId, 128),
    installer: asSafeString(input.installer, 64),
    platform: asSafeString(input.platform, 64),
    source: asSafeString(input.source, 64),
    status: status as InstallEventStatus,
    version: asSafeString(input.version, 64)
  };
};

const getRequestBody = (event: ApiGatewayEvent) => {
  if (!event.body) {
    return '';
  }
  if (!event.isBase64Encoded) {
    return event.body;
  }
  return Buffer.from(event.body, 'base64').toString('utf8');
};

const capturePosthogEvent = async (installEvent: InstallEvent) => {
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  if (!token) {
    return false;
  }

  const host = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(`${host}/i/v0/e/`, {
      body: JSON.stringify({
        api_key: token,
        distinct_id: installEvent.installId || randomUUID(),
        event: `docstube install ${installEvent.status}`,
        properties: {
          ...installEvent,
          $geoip_disable: true,
          $process_person_profile: false,
          event_schema_version: 1,
          telemetry_source: 'install-events'
        }
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal
    });
    return response.ok;
  } finally {
    clearTimeout(timeout);
  }
};

export const handler = async (event: ApiGatewayEvent): Promise<ApiResponse> => {
  const method = event.requestContext?.http?.method || 'GET';

  if (method === 'OPTIONS') {
    return jsonResponse(204, {});
  }
  if (method === 'GET') {
    return jsonResponse(200, { ok: true });
  }
  if (method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const requestBody = getRequestBody(event);
  if (requestBody.length > 4096) {
    return jsonResponse(413, { error: 'body_too_large' });
  }

  let body: unknown;
  try {
    body = JSON.parse(requestBody);
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const installEvent = parseInstallEvent(body);
  if (!installEvent) {
    return jsonResponse(400, { error: 'invalid_event' });
  }

  try {
    await capturePosthogEvent(installEvent);
  } catch {
    return jsonResponse(202, { accepted: true, tracked: false });
  }

  return jsonResponse(202, { accepted: true });
};
