import serverless from 'serverless-http';
import { createApplication } from './application.js';

// HTTP API payload format 2.0. No credentials or transport types enter game logic.
export interface HttpApiEvent {
  version: '2.0';
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  requestContext: {
    requestId: string;
    http: { method: string; path: string; sourceIp: string; protocol?: string; userAgent?: string };
    [key: string]: unknown;
  };
  body?: string;
  isBase64Encoded: boolean;
  [key: string]: unknown;
}

export function createLambdaHandler(factory = createApplication) {
  let initialization: Promise<serverless.Handler> | undefined;
  return async (event: HttpApiEvent, context: { callbackWaitsForEmptyEventLoop?: boolean }) => {
    context.callbackWaitsForEmptyEventLoop = false;
    if (event.version !== '2.0') {
      return { statusCode: 400, body: JSON.stringify({ message: 'HTTP API payload format 2.0 is required' }) };
    }
    // The gateway's default route can forward preflight. Gateway owns the exact
    // origin/method/header allowlist; this response grants no CORS permissions.
    if (event.requestContext.http.method === 'OPTIONS') {
      return { statusCode: 204, body: '' };
    }
    try {
      // Cache the promise as well as the result: overlapping cold calls initialize once.
      initialization ??= factory().then(app => serverless(app.getHttpAdapter().getInstance())).catch(error => {
        initialization = undefined;
        throw error;
      });
      const dispatch = await initialization;
      return await dispatch(event, context);
    } catch {
      console.error('Lambda request failed'); // Never log event, environment or driver errors.
      return {
        statusCode: 503, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusCode: 503, message: 'Service temporarily unavailable', error: 'Service Unavailable' }),
      };
    }
  };
}

export const handler = createLambdaHandler();
