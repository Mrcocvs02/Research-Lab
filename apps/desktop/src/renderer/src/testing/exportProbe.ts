import { createElement } from 'react';
import { useAiUi } from '../lib/aiUi';

/** Test helper: shows what the second-brain export dialog was asked to start from (`closed` when it was not opened). */
export function ExportProbe() {
  const { exportInit } = useAiUi();
  return createElement('output', { 'data-testid': 'export-probe' }, exportInit ? JSON.stringify(exportInit) : 'closed');
}
