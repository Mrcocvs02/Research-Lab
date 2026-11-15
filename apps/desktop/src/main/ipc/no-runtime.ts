import { AppError } from '@rl/core';
import type { MainServices } from './handlers/services.js';

/** Stand-in for the library runtime in tests that do not scan or search. */
export const noRuntime: MainServices['runtime'] = {
  sync: async () => {},
  hold: () => () => {},
  status: () => ({ libraryId: null, state: 'idle', seen: 0, processed: 0, indexed: 0 }),
  require: async () => {
    throw new AppError('LIBRARY_NOT_ACTIVE', 'No runtime in this test');
  },
};
