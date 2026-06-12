import type { logger } from "hono/logger";
import type { Provider } from "./providers/types";
import type { ProfilePayload, ProfileSchema } from "./profiles";
import type { StorageAdapter } from "./storage/storage";

export type Prettify<T> = {
  [K in keyof T]: T[K];
};

export interface OnSuccessResponder<
  T extends { type: string; properties: any },
> {
  profile<Type extends T["type"]>(
    type: Type,
    properties: Extract<T, { type: Type }>["properties"],
    opts?: {
      ttl?: {
        access?: number;
        refresh?: number;
      };
      profile?: string;
    },
  ): Promise<Response>;
}

export type CreateAuthOptions<
  Providers extends Record<string, Provider>,
  Profiles extends ProfileSchema,
  Result = {
    [key in keyof Providers]: Prettify<{
      provider: key & (Providers[key] extends Provider<infer T> ? T : {});
    }>;
  }[keyof Providers],
> = {
  logger?: boolean | Parameters<typeof logger>[0];
  debug?: boolean;
  profiles: Profiles;
  providers: Providers;
  signing: {
    privateKey: string;
    publicKey: string;
  };
  storage?: StorageAdapter;
  ttl: {
    access?: number;
    refresh?: number;
  };
  callback(
    response: OnSuccessResponder<ProfilePayload<Profiles>>,
    input: Result,
    req: Request,
  ): Promise<any>;
};
