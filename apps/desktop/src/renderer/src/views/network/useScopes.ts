import { useEffect, useState } from 'react';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { useFolderOptions } from '../library/useFolderOptions';

export interface ScopeOptions {
  folders: string[];
  projects: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; label: string }>;
  tagLabel(id: string): string;
}

/** Folders, projects and tags the map can be limited to and the network can start from (loaded once, kept current). */
export function useScopeOptions(): ScopeOptions {
  const folders = useFolderOptions();
  const { activeLibraryId } = useApp();
  const taxVersion = useChangeVersion('taxonomy');
  const projVersion = useChangeVersion('projects');
  const [projects, setProjects] = useState<ScopeOptions['projects']>([]);
  const [tags, setTags] = useState<ScopeOptions['tags']>([]);

  useEffect(() => {
    let live = true;
    rl.invoke('projects:list', {}).then(
      (r) => live && setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))),
      () => live && setProjects([]),
    );
    return () => {
      live = false;
    };
  }, [activeLibraryId, projVersion]);

  useEffect(() => {
    let live = true;
    rl.invoke('taxonomy:get', {}).then(
      (r) => live && setTags(r.nodes.filter((n) => n.status !== 'deprecated').map((n) => ({ id: n.id, label: n.label })).sort((a, b) => a.label.localeCompare(b.label))),
      () => live && setTags([]),
    );
    return () => {
      live = false;
    };
  }, [activeLibraryId, taxVersion]);

  const byId = new Map(tags.map((x) => [x.id, x.label]));
  return { folders, projects, tags, tagLabel: (id) => byId.get(id) ?? id };
}
