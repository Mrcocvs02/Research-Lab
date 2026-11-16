/**
 * Plain constants shared by the schemas and the renderer. No imports: the renderer reads them without pulling zod
 * into its first screen (D-172).
 */

/** Upper bounds of the free text of a project, and of its members. */
export const PROJECT_LIMITS = { name: 200, description: 5000, notes: 200_000, note: 2000, members: 20_000 } as const;

/** Upper bounds of search requests; `idsMax` is also the most documents one selection (Ctrl+A) and one bulk action can hold. */
export const SEARCH_LIMITS = { text: 500, listMax: 200, filterValues: 50, idsMax: 50_000 } as const;
