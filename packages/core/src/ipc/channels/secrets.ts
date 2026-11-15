import { z } from 'zod';
import { itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

const scope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('app') }), z.object({ kind: z.literal('library'), libraryId: itemIdSchema })]);
const name = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/, 'invalid secret name');

/** Deliberately no `get`: secret values never travel to the renderer. */
export const secretsChannels = defineChannels('secrets', {
  set: { request: z.object({ scope, name, value: z.string().min(1).max(8192) }), response: z.object({}) },
  has: { request: z.object({ scope, name }), response: z.object({ exists: z.boolean() }) },
  delete: { request: z.object({ scope, name }), response: z.object({}) },
});
