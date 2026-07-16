import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, COMMAND_PRIORITY_LOW } from 'lexical';
import { useEffect, useState } from 'react';
import { MermaidEditModal } from '../components/MermaidEditModal';
import { $isMermaidNode, OPEN_MERMAID_MODAL_COMMAND } from './MermaidNode';

interface ModalState {
  nodeKey: string;
  source: string;
  isNew: boolean;
}

/**
 * Registers OPEN_MERMAID_MODAL_COMMAND and hosts the one modal it can open.
 * Only one diagram is ever edited at a time, so a single state slot is enough.
 */
export function MermaidModalPlugin() {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ModalState | null>(null);

  useEffect(() => {
    return editor.registerCommand(
      OPEN_MERMAID_MODAL_COMMAND,
      ({ nodeKey, isNew }) => {
        // insertMermaid dispatches this command right after its own
        // editor.update(): that update's commit is deferred to a microtask,
        // so editor.getEditorState() would still be one state behind here.
        // editor.read() flushes any pending update first (the same technique
        // BlockEditor's own flush() uses), so the freshly-inserted node is
        // always visible.
        let source: string | null = null;
        editor.read(() => {
          const node = $getNodeByKey(nodeKey);
          if ($isMermaidNode(node)) source = node.getSource();
        });
        if (source === null) return false;
        setState({ nodeKey, source, isNew: isNew ?? false });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  if (!state) return null;

  const close = () => setState(null);

  return (
    <MermaidEditModal
      initialSource={state.source}
      isNew={state.isNew}
      onSave={(next) => {
        editor.update(() => {
          const node = $getNodeByKey(state.nodeKey);
          if ($isMermaidNode(node)) node.setSource(next);
        });
        close();
      }}
      onCancel={() => {
        if (state.isNew) {
          editor.update(() => {
            $getNodeByKey(state.nodeKey)?.remove();
          });
        }
        close();
      }}
    />
  );
}
