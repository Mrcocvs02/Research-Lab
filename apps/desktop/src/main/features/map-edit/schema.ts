import { documentIdSchema, itemIdSchema, MAP_EDIT_LIMITS, relativePathSchema, type MapView, type MapViewInput } from '@rl/core';
import { z } from 'zod';

/** Schemas of the saved views (D-527), checked in the lazy chunk of the views (not in the first load): what comes from the renderer and what is read from the file. */
const frame = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fit') }),
  z.object({ kind: z.literal('blocks'), ids: z.array(z.string().max(200)).max(MAP_EDIT_LIMITS.frameBlocks) }),
  z.object({ kind: z.literal('docs') }),
  z.object({ kind: z.literal('camera'), cx: z.number(), cy: z.number(), k: z.number(), sig: z.string().max(400) }),
]);
const state = z.object({
  family: z.string().min(1).max(200),
  scope: z.object({ folder: relativePathSchema.optional(), projectId: z.string().max(100).optional(), tagId: itemIdSchema.optional() }).optional(),
  years: z.array(z.number().int().min(1000).max(3000)).length(2).optional(),
  filters: z.object({ onlyUnread: z.boolean().optional(), gaps: z.boolean().optional(), kinds: z.array(z.enum(['cites', 'linked', 'similar'])).max(3), strictness: z.enum(['strict', 'normal', 'wide']), edgeMode: z.enum(['selected', 'strong', 'none']) }),
  selection: z.array(documentIdSchema).max(MAP_EDIT_LIMITS.selection),
  focus: documentIdSchema.optional(),
  frame,
});
const fields = { name: z.string().trim().min(1).max(MAP_EDIT_LIMITS.name), projectId: z.string().min(1).max(100).nullable().optional(), state };
const stamp = z.iso.datetime({ offset: true });
export const mapViewSchema = z.object({ id: z.string().min(1).max(100), ...fields, createdAt: stamp, updatedAt: stamp }) satisfies z.ZodType<MapView>;
export const mapViewInputSchema = z.object({ id: z.string().min(1).max(100).optional(), createdAt: stamp.optional(), ...fields }) satisfies z.ZodType<MapViewInput>;
