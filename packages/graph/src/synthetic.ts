import { makeRandom } from './random.js';
import type { GraphDoc } from './types.js';

export interface SyntheticOptions {
  seed?: number;
  /** Number of topics (default 5); documents are spread evenly. */
  topics?: number;
  /** Words per topic vocabulary (default 40). */
  vocabulary?: number;
  /** Words of body text per document (default 60). */
  bodyWords?: number;
}

/** Coined word `t<topic>w<index>` (letters only, so the tokenizer keeps it): invented, no relation to any real term. */
export const topicWord = (topic: number, index: number): string => `zq${String.fromCharCode(97 + (topic % 26))}${String.fromCharCode(97 + Math.floor(topic / 26))}x${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`;

/**
 * Synthetic documents grouped in topics: each document draws most of its words from its topic's vocabulary and a few
 * from a shared one. `topic` of document `i` is `i % topics`. Same seed, same documents.
 */
export function syntheticDocs(count: number, options: SyntheticOptions = {}): Array<GraphDoc & { topic: number }> {
  const topics = options.topics ?? 5;
  const vocab = options.vocabulary ?? 40;
  const body = options.bodyWords ?? 60;
  const rnd = makeRandom(options.seed ?? 1);
  const pick = (topic: number) => topicWord(topic, Math.floor(rnd() * vocab));
  const common = ['method', 'analysis', 'model', 'results', 'study', 'approach'];
  const docs: Array<GraphDoc & { topic: number }> = [];
  for (let i = 0; i < count; i++) {
    const topic = i % topics;
    const words = (n: number) => Array.from({ length: n }, () => (rnd() < 0.85 ? pick(topic) : (common[Math.floor(rnd() * common.length)] as string))).join(' ');
    docs.push({
      id: i.toString(16).padStart(16, '0'),
      sig: '1',
      folder: `folder${i % 3}`,
      title: words(5),
      abstract: words(25),
      keywords: [],
      text: words(body),
      tags: [`tag${topic}`],
      refs: [],
      cites: [],
      topic,
    });
  }
  return docs;
}
