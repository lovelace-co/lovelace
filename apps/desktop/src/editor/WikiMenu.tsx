import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createTextNode, $getSelection, $isRangeSelection, type TextNode } from 'lexical';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WikiCandidate } from '../lib/links';
import { $createWikiLinkNode } from './WikiLinkNode';

/** One entry in the `[[` link menu. */
class WikiOption extends MenuOption {
  constructor(
    public id: string,
    public label: string,
    public kind: string,
    public hint: string,
  ) {
    super(id);
  }
}

/**
 * The `[[` trigger: matches an open double-bracket and everything typed after
 * it up to the caret, so the menu opens on `[[` and filters as you type. A
 * closing `]` or a newline ends the match.
 */
function wikiTrigger(text: string): MenuTextMatch | null {
  const match = /\[\[([^[\]\n]*)$/.exec(text);
  if (match === null) return null;
  return {
    leadOffset: match.index,
    matchingString: match[1] ?? '',
    replaceableString: match[0],
  };
}

const MAX_RESULTS = 12;

/** Type `[[` to link another ticket or brief by its title; inserts `[[id]]`. */
export function WikiMenuPlugin({ candidates }: { candidates: WikiCandidate[] }) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);

  const options = useMemo(() => {
    const q = (query ?? '').toLowerCase();
    const matches = q === ''
      ? candidates
      : candidates.filter(
          (c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
        );
    return matches.slice(0, MAX_RESULTS).map((c) => new WikiOption(c.id, c.label, c.kind, c.hint));
  }, [candidates, query]);

  const onSelect = useCallback(
    (option: WikiOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const link = $createWikiLinkNode(option.id);
        if (nodeToRemove) {
          nodeToRemove.replace(link);
        } else {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) selection.insertNodes([link]);
        }
        // A trailing space so the caret lands outside the link node.
        const space = $createTextNode(' ');
        link.insertAfter(space);
        space.select(1, 1);
      });
      closeMenu();
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<WikiOption>
      onQueryChange={setQuery}
      onSelectOption={onSelect}
      triggerFn={wikiTrigger}
      options={options}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorRef.current && options.length > 0
          ? createPortal(
              <ul className="slash-menu wiki-menu" role="listbox">
                {options.map((option, i) => (
                  <li
                    key={option.key}
                    role="option"
                    aria-selected={selectedIndex === i}
                    className={`slash-item wiki-item${selectedIndex === i ? ' selected' : ''}`}
                    onPointerEnter={() => setHighlightedIndex(i)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      selectOptionAndCleanUp(option);
                    }}
                  >
                    <span className="wiki-item-main">
                      <span className={`wiki-item-kind ${option.kind}`}>{option.kind}</span>
                      <span className="wiki-item-label">{option.label}</span>
                    </span>
                    {option.hint && <span className="wiki-item-hint">{option.hint}</span>}
                  </li>
                ))}
              </ul>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
