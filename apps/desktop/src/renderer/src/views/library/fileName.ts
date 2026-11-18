/** The extension of a path, lower case, without the dot (`''` when there is none). */
export const fileExt = (path: string): string => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(path);
  return m ? m[1]!.toLowerCase() : '';
};

/** The last segment of a `/` path. */
export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
