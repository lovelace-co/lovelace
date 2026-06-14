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
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
} from 'lexical';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** One entry in the slash menu. */
class SlashOption extends MenuOption {
  constructor(
    public title: string,
    public hint: string,
    public keywords: string[],
    public apply: (editor: LexicalEditor) => void,
  ) {
    super(title);
  }
}

function blockSetter(create: () => ElementNode) {
  return (editor: LexicalEditor) =>
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) $setBlocksType(selection, create);
    });
}

function buildOptions(): SlashOption[] {
  return [
    new SlashOption('Text', 'Plain paragraph', ['paragraph', 'p', 'text'], blockSetter(() => $createParagraphNode())),
    new SlashOption('Heading 1', 'Section title', ['h1', 'heading'], blockSetter(() => $createHeadingNode('h1'))),
    new SlashOption('Heading 2', 'Subsection', ['h2'], blockSetter(() => $createHeadingNode('h2'))),
    new SlashOption('Heading 3', 'Small heading', ['h3'], blockSetter(() => $createHeadingNode('h3'))),
    new SlashOption('Bulleted list', 'Simple list', ['ul', 'bullet', 'list'], (e) =>
      e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
    ),
    new SlashOption('Numbered list', 'Ordered list', ['ol', 'numbered'], (e) =>
      e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
    ),
    new SlashOption('Task list', 'Punchable checkboxes', ['todo', 'task', 'check'], (e) =>
      e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
    ),
    new SlashOption('Quote', 'Pulled aside', ['quote', 'blockquote'], blockSetter(() => $createQuoteNode())),
    new SlashOption('Code block', 'Fenced code', ['code', 'fence'], blockSetter(() => $createCodeNode())),
  ];
}

/** The playground-style component picker: type / to insert a block. */
export function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch('/', { minLength: 0 });

  const options = useMemo(() => {
    const all = buildOptions();
    if (query === null || query === '') return all;
    const q = query.toLowerCase();
    return all.filter(
      (o) => o.title.toLowerCase().includes(q) || o.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

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
                {options.map((option, i) => (
                  <li
                    key={option.key}
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
                ))}
              </ul>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
