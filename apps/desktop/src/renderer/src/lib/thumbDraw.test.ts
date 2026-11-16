// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THUMB_LIMITS } from '@rl/core';

// pdf.js and the canvas are fakes: this checks the sizes, the encoding fallback and the clean-up, not the rendering.
const pdf = vi.hoisted(() => {
  const state = {
    page: { w: 595, h: 842 },
    passwordNeeded: false,
    openError: null as unknown,
    destroyed: 0,
    workers: [] as Array<{ destroy: ReturnType<typeof vi.fn> }>,
    params: null as any,
    cleaned: 0,
  };
  const lib = {
    PDFWorker: class {
      destroy = vi.fn();
      constructor() {
        state.workers.push(this);
      }
    },
    getDocument: (params: any) => {
      state.params = params;
      const task: any = {
        onPassword: null,
        destroy: vi.fn(async () => void state.destroyed++),
      };
      task.promise = new Promise((resolve, reject) => {
        queueMicrotask(() => {
          if (state.passwordNeeded) return task.onPassword?.();
          if (state.openError) return reject(state.openError);
          resolve({
            getPage: async () => ({
              getViewport: ({ scale }: { scale: number }) => ({ width: state.page.w * scale, height: state.page.h * scale }),
              render: () => ({ promise: Promise.resolve() }),
              cleanup: () => void state.cleaned++,
            }),
          });
        });
      });
      return task;
    },
  };
  return { state, lib };
});
vi.mock('./pdfjs', () => ({
  loadPdfjs: async () => pdf.lib,
  pdfDocumentParams: (url: string) => ({ url, isEvalSupported: false }),
}));

import { DrawError, drawFirstPage, releaseDrawer, thumbSize } from './thumbDraw';

let sizesOfEncodes: number[];
let canvases: Array<{ width: number; height: number }>;
beforeEach(() => {
  pdf.state.page = { w: 595, h: 842 };
  pdf.state.passwordNeeded = false;
  pdf.state.openError = null;
  pdf.state.destroyed = 0;
  pdf.state.cleaned = 0;
  pdf.state.workers.length = 0;
  sizesOfEncodes = [];
  canvases = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag);
    const c = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: () => {} }),
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        const size = sizesOfEncodes.shift() ?? 1000;
        cb(new Blob([new Uint8Array(size)], { type }) as Blob);
        void q;
      },
    };
    canvases.push(c);
    return c as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});
afterEach(() => {
  releaseDrawer();
  vi.restoreAllMocks();
});

describe('thumbSize', () => {
  it('is 240 CSS pixels wide, times the pixel ratio', () => {
    expect(thumbSize(600, 800, 1)).toMatchObject({ width: 240, height: 320 });
    expect(thumbSize(600, 600, 2)).toMatchObject({ width: 480, height: 480 });
    expect(thumbSize(600, 800, 2)).toMatchObject({ width: 384, height: 512 }); // the tall side is capped
  });
  it('never goes above the largest side, tall pages and wide pages alike', () => {
    for (const [w, h] of [[600, 3000], [3000, 600], [100, 100], [10, 5000]] as const) {
      const s = thumbSize(w, h, 3);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(THUMB_LIMITS.maxSide);
      expect(Math.min(s.width, s.height)).toBeGreaterThanOrEqual(1);
    }
  });
  it('a nonsense pixel ratio counts as 1', () => {
    expect(thumbSize(600, 800, 0).width).toBe(240);
    expect(thumbSize(600, 800, Number.NaN).width).toBe(240);
  });
});

describe('drawFirstPage', () => {
  it('opens the url with the shared options, draws the page and gives back WebP bytes', async () => {
    sizesOfEncodes = [5000];
    const out = await drawFirstPage('rl-doc://doc/0000000000000001?v=aaaaaaaa');
    expect(out.byteLength).toBe(5000);
    expect(pdf.state.params).toMatchObject({ url: 'rl-doc://doc/0000000000000001?v=aaaaaaaa', isEvalSupported: false });
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 }); // emptied after use
    expect(pdf.state.destroyed).toBe(1); // the loading task is destroyed
    expect(pdf.state.cleaned).toBe(1);
  });

  it('lowers the quality until the image fits, and fails when nothing does', async () => {
    sizesOfEncodes = [THUMB_LIMITS.maxBytes + 1, THUMB_LIMITS.maxBytes + 1, 900];
    expect((await drawFirstPage('rl-doc://doc/x')).byteLength).toBe(900);
    sizesOfEncodes = Array(10).fill(THUMB_LIMITS.maxBytes + 1);
    await expect(drawFirstPage('rl-doc://doc/x')).rejects.toBeInstanceOf(DrawError);
    expect(pdf.state.destroyed).toBe(2);
  });

  it('an encrypted PDF is refused as encrypted, a damaged one as invalid, and the task is still destroyed', async () => {
    pdf.state.passwordNeeded = true;
    await expect(drawFirstPage('rl-doc://doc/x')).rejects.toMatchObject({ kind: 'encrypted' });
    pdf.state.passwordNeeded = false;
    pdf.state.openError = Object.assign(new Error('x'), { name: 'InvalidPDFException' });
    await expect(drawFirstPage('rl-doc://doc/x')).rejects.toMatchObject({ kind: 'invalid' });
    pdf.state.openError = new Error('network');
    await expect(drawFirstPage('rl-doc://doc/x')).rejects.toMatchObject({ kind: 'failed' });
    expect(pdf.state.destroyed).toBe(3);
  });

  it('shares one worker between drawings and releaseDrawer stops it', async () => {
    await drawFirstPage('rl-doc://doc/a');
    await drawFirstPage('rl-doc://doc/b');
    expect(pdf.state.workers).toHaveLength(1);
    releaseDrawer();
    expect(pdf.state.workers[0]!.destroy).toHaveBeenCalledTimes(1);
    await drawFirstPage('rl-doc://doc/c');
    expect(pdf.state.workers).toHaveLength(2);
    releaseDrawer();
    releaseDrawer(); // twice is fine
    expect(pdf.state.workers[1]!.destroy).toHaveBeenCalledTimes(1);
  });
});
