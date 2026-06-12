import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Prettify } from "./types";

export type ProfileSchema = Record<string, StandardSchemaV1>;

/** @internal */
export type ProfilePayload<T extends ProfileSchema> = Prettify<
  {
    [type in keyof T & string]: {
      type: type;
      properties: StandardSchemaV1.InferOutput<T[type]>;
    };
  }[keyof T & string]
>;

/**
 * Create a profile schema.
 *
 * @example
 * ```ts
 * const profiles = defineProfiles({
 *   user: z.object({
 *     userId: z.string()
 *   }),
 *   admin: z.object({
 *     workspaceId: z.string()
 *   })
 * })
 * ```
 */
export function defineProfiles<Schema extends ProfileSchema = {}>(
  types: Schema,
): Schema {
  return { ...types };
}
