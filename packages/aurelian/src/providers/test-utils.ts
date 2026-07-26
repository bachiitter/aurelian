import { Hono } from 'hono';
import type {
  Provider,
  ProviderEnvironment,
  ProviderIdentity,
} from '../types.js';

type ProviderTestOptions = {
  callback?: {
    callbackURL: string;
    code: string;
    state: string;
  };
  providerId?: string;
  scopes?: string[];
};

export function createProviderTestApp(
  provider: Provider,
  options: ProviderTestOptions = {},
): Hono<ProviderEnvironment> {
  const app = new Hono<ProviderEnvironment>();

  app.use('*', async (context, next) => {
    context.set('requestId', 'request_test');
    context.set('aurelian', {
      async authenticate(identity) {
        return Response.json(await identity);
      },
      async authorize(flow) {
        const request = context.req.raw;
        const callbackURL =
          options.callback?.callbackURL ??
          'https://auth.example.com/provider/callback';
        const url = await flow.authorizationUrl({
          callbackURL,
          request,
          scopes: options.scopes,
          state: options.callback?.state ?? 'state_123',
        });

        return Response.json({ url: url.toString() });
      },
      async callback(flow) {
        const callback = options.callback ?? {
          callbackURL: 'https://auth.example.com/provider/callback',
          code: 'code_123',
          state: 'state_123',
        };
        const identity: ProviderIdentity = await flow.callback({
          ...callback,
          request: context.req.raw,
        });

        return Response.json(identity);
      },
      providerId: options.providerId ?? 'provider',
    });
    await next();
  });
  app.onError((error) =>
    Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    ),
  );
  app.route('/', provider.router);

  return app;
}
