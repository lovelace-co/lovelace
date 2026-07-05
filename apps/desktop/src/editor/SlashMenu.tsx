import { $createCodeNode } from '@lexical/code';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $setBlocksType } from '@lexical/selection';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
} from 'lexical';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LinkKind, ReferenceCandidate } from '../lib/links';
import { $createWikiLinkNode } from './WikiLinkNode';

/** One entry in the unified insert menu, tagged with the section it belongs to. */
class SlashOption extends MenuOption {
  constructor(
    public title: string,
    public hint: string,
    public keywords: string[],
    public apply: (editor: LexicalEditor) => void,
    public group: string,
    key?: string,
  ) {
    super(key ?? title);
  }
}

function blockSetter(create: () => ElementNode) {
  return (editor: LexicalEditor) =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, create);
    });
}

/** Inserts a reference chip for the given token, then a trailing space. */
function insertReference(token: string) {
  return (editor: LexicalEditor) =>
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const node = $createWikiLinkNode(token);
      selection.insertNodes([node]);
      const space = $createTextNode(' ');
      node.insertAfter(space);
      space.select(1, 1);
    });
}

function formatOptions(): SlashOption[] {
  return [
    new SlashOption('Text', 'Plain paragraph', ['paragraph', 'p', 'text'], blockSetter(() => $createParagraphNode()), 'Format'),
    new SlashOption('Heading 1', 'Section title', ['h1', 'heading'], blockSetter(() => $createHeadingNode('h1')), 'Format'),
    new SlashOption('Heading 2', 'Subsection', ['h2'], blockSetter(() => $createHeadingNode('h2')), 'Format'),
    new SlashOption('Heading 3', 'Small heading', ['h3'], blockSetter(() => $createHeadingNode('h3')), 'Format'),
    new SlashOption('Bulleted list', 'Simple list', ['ul', 'bullet', 'list'], (e) => e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined), 'Format'),
    new SlashOption('Numbered list', 'Ordered list', ['ol', 'numbered'], (e) => e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined), 'Format'),
    new SlashOption('Task list', 'Punchable checkboxes', ['todo', 'task', 'check'], (e) => e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined), 'Format'),
    new SlashOption('Quote', 'Pulled aside', ['quote', 'blockquote'], blockSetter(() => $createQuoteNode()), 'Format'),
    new SlashOption('Code block', 'Fenced code', ['code', 'fence'], blockSetter(() => $createCodeNode()), 'Format'),
  ];
}

/** Section label and result cap for each reference kind, in menu order. */
const REFERENCE_GROUPS: Array<{ kind: LinkKind; label: string; cap: number }> = [
  { kind: 'ticket', label: 'Tickets', cap: 5 },
  { kind: 'document', label: 'Documents', cap: 5 },
  { kind: 'file', label: 'Files', cap: 6 },
];

/**
 * Builds the menu for a query: matching Format commands, then matching
 * references grouped Tickets / Documents / Files. References only appear once
 * the user has typed (there can be thousands of files).
 */
function buildOptions(candidates: ReferenceCandidate[], query: string): SlashOption[] {
  const q = query.toLowerCase();
  const format =
    q === ''
      ? formatOptions()
      : formatOptions().filter(
          (o) => o.title.toLowerCase().includes(q) || o.keywords.some((k) => k.includes(q)),
        );
  if (q === '') return format;

  const refs: SlashOption[] = [];
  for (const group of REFERENCE_GROUPS) {
    const matches = candidates
      .filter(
        (c) =>
          c.kind === group.kind &&
          (c.label.toLowerCase().includes(q) || c.token.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)),
      )
      .slice(0, group.cap);
    for (const c of matches) {
      refs.push(new SlashOption(c.label, c.hint, [], insertReference(c.token), group.label, c.token));
    }
  }
  return [...format, ...refs];
}

/** The unified insert menu: type / for formatting, or / then a name to link a ticket, document or file. */
export function SlashMenuPlugin({ candidates = [] }: { candidates?: ReferenceCandidate[] }) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch('/', { minLength: 0 });

  const options = useMemo(() => buildOptions(candidates, query ?? ''), [candidates, query]);

  const onSelect = useCallback(
    (option: SlashOption, nodeToRemove: { remove: () => void } | null, closeMenu: () => void) => {
      editor.update(() => {
        nodeToRemove?.remove();
      });
      option.apply(editor);
      closeMenu();
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashOption>
      onQueryChange={setQuery}
      onSelectOption={onSelect}
      triggerFn={trigger}
      options={options}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorRef.current && options.length > 0
          ? createPortal(
              <ul className="slash-menu" role="listbox">
                {options.map((option, i) => {
                  const newGroup = i === 0 || options[i - 1]?.group !== option.group;
                  return (
                    <Fragment key={option.key}>
                      {newGroup && (
                        <li className="slash-section" role="presentation" aria-hidden>
                          {option.group}
                        </li>
                      )}
                      <li
                        role="option"
                        aria-selected={selectedIndex === i}
                        className={`slash-item${selectedIndex === i ? ' selected' : ''}`}
                        onPointerEnter={() => setHighlightedIndex(i)}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          selectOptionAndCleanUp(option);
                        }}
                      >
                        <span className="slash-title">{option.title}</span>
                        <span className="slash-hint">{option.hint}</span>
                      </li>
                    </Fragment>
                  );
                })}
              </ul>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
