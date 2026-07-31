import type { StandardSchemaV1 } from "@standard-schema/spec";

export type ProviderIdentity = {
  avatarUrl?: string;
  email?: string;
  emailVerified?: boolean;
  id: string;
  name?: string;
  raw?: unknown;
  username?: string;
};

export type ProfileSchema = Record<string, StandardSchemaV1>;

export type ProfileProperties<Schema extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<Schema>;

export type ProfilePayload<Schema extends ProfileSchema> = {
  [Type in keyof Schema & string]: {
    properties: ProfileProperties<Schema[Type]>;
    type: Type;
  };
}[keyof Schema & string];

export type ProfileFactory<Schema extends ProfileSchema> = <Type extends keyof Schema & string>(
  type: Type,
  properties: ProfileProperties<Schema[Type]>,
) => {
  properties: ProfileProperties<Schema[Type]>;
  type: Type;
};

export type ProfileResolver<
  Providers extends Record<string, unknown>,
  Profiles extends ProfileSchema,
> = (input: {
  profile: ProfileFactory<Profiles>;
  request: Request;
  response: {
    data: ProviderIdentity;
    provider: keyof Providers & string;
  };
}) => ProfilePayload<Profiles> | Promise<ProfilePayload<Profiles>>;

export function defineProfiles<Schema extends ProfileSchema>(profiles: Schema): Schema {
  return profiles;
}

export async function validateProfile<
  Schema extends ProfileSchema,
  Type extends keyof Schema & string,
>(
  profile: {
    properties: ProfileProperties<Schema[Type]>;
    type: Type;
  },
  profiles: Schema,
): Promise<{
  profile: {
    properties: ProfileProperties<Schema[Type]>;
    type: Type;
  };
  profileId: string;
}> {
  const schema = profiles[profile.type];

  if (!schema) {
    throw new Error("profile_type_invalid");
  }

  const result = await schema["~standard"].validate(profile.properties);

  if (result.issues) {
    throw new Error("profile_invalid");
  }

  if (
    typeof result.value !== "object" ||
    result.value === null ||
    !("id" in result.value) ||
    typeof result.value.id !== "string" ||
    result.value.id.length === 0 ||
    result.value.id.length > 512
  ) {
    throw new Error("profile_id_invalid");
  }

  return {
    profile: {
      properties: result.value,
      type: profile.type,
    },
    profileId: result.value.id,
  };
}
