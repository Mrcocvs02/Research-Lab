import path from 'node:path';

/** Where the regenerable graph files of a library live: machine-local, never in the synced data folder. */
export function graphPaths(localDataDir: string, libraryId: string) {
  const dir = path.join(localDataDir, 'graph', libraryId);
  return { dir, modelFile: path.join(dir, 'model.json'), labelsFile: path.join(dir, 'labels.json'), metaFile: path.join(dir, 'meta.json') };
}
