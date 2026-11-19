import { Lazy, lazyView } from '../../../components/Lazy';
import { NoteEditor } from '../../notes/NoteEditor';

// The literature note (feature 2) is its own lazy chunk: nothing of it loads until the card is open (D-426).
const LiteratureRow = lazyView(() => import('../../literature/LiteratureNote').then((m) => ({ default: m.LiteratureRow })), ['literature', 'reader']);

/**
 * The content of the "Notes" section of the card: the note on the file, with its incoming links at the bottom (they come with
 * the editor), and the literature note of the paper (§17.4.6). The two stay apart: the note of the user is theirs, the
 * literature note is the AI's draft until they approve it.
 */
export function NotesSection({ docId }: { docId: string }) {
  return (
    <>
      <NoteEditor docId={docId} testId="card-note" />
      <Lazy>
        <LiteratureRow docId={docId} />
      </Lazy>
    </>
  );
}
