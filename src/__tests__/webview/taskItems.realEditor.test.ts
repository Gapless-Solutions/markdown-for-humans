/** @jest-environment jsdom */

/**
 * Integration tests for task-item check/uncheck against a real TipTap editor,
 * wired the way the production webview wires it.
 *
 * A real editor rather than stubs because every interesting case here is
 * ProseMirror position math — which item a cursor is "in" when items are
 * nested, and what a selection spanning several items should touch. Stubs
 * would let that math be wrong and still pass.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ListKit } from '@tiptap/extension-list';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { OrderedListMarkdownFix } from '../../webview/extensions/orderedListMarkdownFix';
import {
  findTaskItemsInSelection,
  setTaskItemsChecked,
  type TaskStrikeMode,
} from '../../webview/utils/taskItems';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';

function createRealEditor(initialMarkdown: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        paragraph: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        undoRedo: { depth: 100 },
      }),
      MarkdownParagraph,
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
      ListKit.configure({
        orderedList: false,
        taskItem: { nested: true },
      }),
      OrderedListMarkdownFix,
    ],
    // Seed through the constructor, not setContent: a setContent call lands in
    // the undo history and ProseMirror groups it with anything dispatched in
    // the same tick, so the undo test would revert to an empty document.
    content: initialMarkdown,
    contentType: 'markdown',
  });
  return editor;
}

/** Character offset of `text` inside the document, as a ProseMirror position. */
function posOfText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text?.includes(text)) {
      found = pos + (node.text.indexOf(text) ?? 0) + 1;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error(`text not found in doc: ${text}`);
  return found;
}

function checkedStates(editor: Editor): boolean[] {
  const states: boolean[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'taskItem') {
      states.push(node.attrs.checked === true);
    }
    return true;
  });
  return states;
}

function markdownOf(editor: Editor): string {
  return getEditorMarkdownForSync(editor, 'strip');
}

const FLAT = `- [ ] alpha
- [ ] bravo
- [ ] charlie
`;

const NESTED = `- [ ] parent
  - [ ] child
`;

describe('findTaskItemsInSelection', () => {
  it('finds the item containing a collapsed cursor', () => {
    const editor = createRealEditor(FLAT);
    const pos = posOfText(editor, 'bravo');

    const matches = findTaskItemsInSelection(editor.state.doc, pos, pos);

    expect(matches).toHaveLength(1);
    expect(editor.state.doc.nodeAt(matches[0].pos)?.textContent).toContain('bravo');
  });

  it('finds every item a range selection touches', () => {
    const editor = createRealEditor(FLAT);
    const from = posOfText(editor, 'alpha');
    const to = posOfText(editor, 'charlie') + 'charlie'.length;

    expect(findTaskItemsInSelection(editor.state.doc, from, to)).toHaveLength(3);
  });

  it('finds items from a partial selection at both ends', () => {
    const editor = createRealEditor(FLAT);
    const from = posOfText(editor, 'alpha') + 2; // mid-word
    const to = posOfText(editor, 'charlie') + 3; // mid-word

    expect(findTaskItemsInSelection(editor.state.doc, from, to)).toHaveLength(3);
  });

  it('returns nothing when the cursor is outside any task item', () => {
    const editor = createRealEditor(`Just a paragraph.\n`);
    const pos = posOfText(editor, 'paragraph');

    expect(findTaskItemsInSelection(editor.state.doc, pos, pos)).toHaveLength(0);
  });

  it('returns nothing for an empty document', () => {
    const editor = createRealEditor('');
    expect(findTaskItemsInSelection(editor.state.doc, 0, 0)).toHaveLength(0);
  });

  describe('nesting', () => {
    it('takes only the innermost item for a cursor in a nested child', () => {
      // Ancestor task items must not be swept in, or checking a sub-task would
      // silently tick its parent.
      const editor = createRealEditor(NESTED);
      const pos = posOfText(editor, 'child');

      const matches = findTaskItemsInSelection(editor.state.doc, pos, pos);

      expect(matches).toHaveLength(1);
      expect(editor.state.doc.nodeAt(matches[0].pos)?.textContent).toContain('child');
    });

    it('takes only the parent for a cursor in the parent text', () => {
      const editor = createRealEditor(NESTED);
      const pos = posOfText(editor, 'parent');

      const matches = findTaskItemsInSelection(editor.state.doc, pos, pos);

      expect(matches).toHaveLength(1);
      expect(matches[0].ownFrom).toBeLessThan(pos);
    });

    it('takes both when the selection spans parent text into child text', () => {
      const editor = createRealEditor(NESTED);
      const from = posOfText(editor, 'parent');
      const to = posOfText(editor, 'child') + 'child'.length;

      expect(findTaskItemsInSelection(editor.state.doc, from, to)).toHaveLength(2);
    });
  });
});

describe('setTaskItemsChecked', () => {
  function selectText(editor: Editor, from: number, to: number) {
    editor.commands.setTextSelection({ from, to });
  }

  it('checks the item at the cursor', () => {
    const editor = createRealEditor(FLAT);
    const pos = posOfText(editor, 'bravo');
    selectText(editor, pos, pos);

    expect(setTaskItemsChecked(editor, true, 'visual')).toBe(true);
    expect(checkedStates(editor)).toEqual([false, true, false]);
  });

  it('unchecks the item at the cursor', () => {
    const editor = createRealEditor(`- [x] alpha\n`);
    const pos = posOfText(editor, 'alpha');
    selectText(editor, pos, pos);

    expect(setTaskItemsChecked(editor, false, 'visual')).toBe(true);
    expect(checkedStates(editor)).toEqual([false]);
  });

  it('applies to every item in a multi-item selection', () => {
    const editor = createRealEditor(FLAT);
    selectText(editor, posOfText(editor, 'alpha'), posOfText(editor, 'charlie') + 7);

    setTaskItemsChecked(editor, true, 'visual');

    expect(checkedStates(editor)).toEqual([true, true, true]);
  });

  it('drives a mixed selection to the requested state rather than toggling', () => {
    const editor = createRealEditor(`- [x] alpha\n- [ ] bravo\n`);
    selectText(editor, posOfText(editor, 'alpha'), posOfText(editor, 'bravo') + 5);

    setTaskItemsChecked(editor, true, 'visual');

    expect(checkedStates(editor)).toEqual([true, true]);
  });

  it('is a no-op on an already-checked item', () => {
    const editor = createRealEditor(`- [x] alpha\n`);
    const pos = posOfText(editor, 'alpha');
    selectText(editor, pos, pos);

    expect(setTaskItemsChecked(editor, true, 'visual')).toBe(false);
    expect(checkedStates(editor)).toEqual([true]);
  });

  it('does nothing outside a task item', () => {
    const editor = createRealEditor(`Just a paragraph.\n`);
    const pos = posOfText(editor, 'paragraph');
    selectText(editor, pos, pos);

    expect(setTaskItemsChecked(editor, true, 'visual')).toBe(false);
  });

  it('collapses a multi-item change into a single undo step', () => {
    const editor = createRealEditor(FLAT);
    selectText(editor, posOfText(editor, 'alpha'), posOfText(editor, 'charlie') + 7);
    setTaskItemsChecked(editor, true, 'visual');
    expect(checkedStates(editor)).toEqual([true, true, true]);

    editor.commands.undo();

    expect(checkedStates(editor)).toEqual([false, false, false]);
  });

  it('does not cascade to a nested child', () => {
    const editor = createRealEditor(NESTED);
    const pos = posOfText(editor, 'parent');
    selectText(editor, pos, pos);

    setTaskItemsChecked(editor, true, 'visual');

    expect(checkedStates(editor)).toEqual([true, false]);
  });

  describe('strike modes', () => {
    it('visual mode leaves the markdown untouched apart from the box', () => {
      const editor = createRealEditor(`- [ ] alpha\n`);
      const pos = posOfText(editor, 'alpha');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, true, 'visual');

      const md = markdownOf(editor);
      expect(md).toContain('[x]');
      expect(md).not.toContain('~~');
    });

    it('off mode leaves the markdown untouched apart from the box', () => {
      const editor = createRealEditor(`- [ ] alpha\n`);
      const pos = posOfText(editor, 'alpha');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, true, 'off');

      expect(markdownOf(editor)).not.toContain('~~');
    });

    it('markdown mode wraps the item text in ~~ when checked', () => {
      const editor = createRealEditor(`- [ ] alpha\n`);
      const pos = posOfText(editor, 'alpha');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, true, 'markdown');

      const md = markdownOf(editor);
      expect(md).toContain('[x]');
      expect(md).toContain('~~alpha~~');
    });

    it('markdown mode removes the ~~ when unchecked', () => {
      const editor = createRealEditor(`- [x] ~~alpha~~\n`);
      const pos = posOfText(editor, 'alpha');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, false, 'markdown');

      const md = markdownOf(editor);
      expect(md).toContain('[ ]');
      expect(md).not.toContain('~~');
    });

    it('markdown mode does not strike a nested child when the parent is checked', () => {
      const editor = createRealEditor(NESTED);
      const pos = posOfText(editor, 'parent');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, true, 'markdown');

      const md = markdownOf(editor);
      expect(md).toContain('~~parent~~');
      expect(md).not.toContain('~~child~~');
    });

    it.each<TaskStrikeMode>(['visual', 'off'])('%s mode still records the checked state', mode => {
      const editor = createRealEditor(`- [ ] alpha\n`);
      const pos = posOfText(editor, 'alpha');
      selectText(editor, pos, pos);

      setTaskItemsChecked(editor, true, mode);

      expect(checkedStates(editor)).toEqual([true]);
    });
  });
});
