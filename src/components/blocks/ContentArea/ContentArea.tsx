import { useEffect, useRef, useState } from "react";
import type {
  ContentDataSet,
  TextElement,
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
} from "../../../types/types";
import type { TriggerWord } from "../../../types/trigger-words";
import "./content-area.css";

// Per-tag hint shown in an empty block so freshly-added blocks are visible and
// the user knows where to type. Plain <p> gets the generic prompt.
const PLACEHOLDERS: Record<string, string> = {
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  blockquote: "Quote",
  p: "Write something…",
};

// The caret's character offset inside `blockEl`'s text. Read here, in the block
// that owns the contentEditable, so the offset travels on the KeyEventData and no
// downstream module touches the DOM. Returns -1 when there is no caret in scope.
// @flowmap-node contentArea__caret kind=function
function readCaretOffset(blockEl: HTMLElement | null): number {
  if (!blockEl) return -1;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return -1;

  const caretRange = selection.getRangeAt(0);
  if (!blockEl.contains(caretRange.startContainer)) return -1;

  const offsetRange = caretRange.cloneRange();
  offsetRange.selectNodeContents(blockEl);
  offsetRange.setEnd(caretRange.startContainer, caretRange.startOffset);
  return offsetRange.toString().length;
}

interface ContentAreaProps {
  activeContent: TextElement;
  contentDataSet: ContentDataSet;
  cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void;
  cbKeyboardEvent: (keyData: KeyEventData, trigger: TriggerWord) => void;
  cbLifecycleEvent: (
    lifecycleData: LifecycleEventData,
    trigger: TriggerWord,
  ) => void;
}

// @flowmap-node contentArea kind=component
export default function ContentArea({
  activeContent,
  contentDataSet,
  cbMouseEvent,
  cbKeyboardEvent,
  cbLifecycleEvent,
}: ContentAreaProps) {
  const { Tag, innerContent, id, classNames, children, component } =
    activeContent;
  const contentRef = useRef<HTMLElement>(null);

  // Drives the empty-block placeholder. Tracked in React (not via :empty) because
  // focusing an empty editable injects a zero-length text node, which would
  // defeat the :empty selector. Leaf blocks only — a block with nested children
  // is never "empty".
  const isLeaf = !children || children.length === 0;
  const [isEmpty, setIsEmpty] = useState(isLeaf && innerContent.trim() === "");

  // Seed AND re-sync the editable from the committed model text.
  //
  // Runs on mount and on every change to innerContent (the store value). The
  // guard `current.innerText !== innerContent` makes this a no-op during normal
  // typing: the keystroke already put that text in the DOM, so DOM and store
  // match and nothing is rewritten. It writes only when the model changed the
  // text out from under the DOM:
  //   - a range delete cut a span from THIS (same-id) block
  //   - any other programmatic edit set new text
  // The old mount-only effect ran once, so a same-id edit never re-seeded and
  // the model change stayed invisible. innerText (not innerHTML) keeps the SM
  // read/write round-trip consistent.
  // @flowmap-node contentArea__syncEffect kind=function
  useEffect(() => {
    if (!contentRef.current) return;
    if (contentRef.current.innerText === innerContent) return;
    contentRef.current.innerText = innerContent;
  }, [innerContent]);

  // Keep the placeholder in sync as the user types. textContent (not innerText)
  // is the cheap read here; we only care whether anything is there.
  // Also fires the lifecycle conduit with "content-area-key-up" so a manager can
  // observe the live text as it changes.
  // @flowmap-node contentArea__onInput kind=function
  const handleInput = () => {
    if (!isLeaf) return;
    const text = contentRef.current?.textContent ?? "";
    setIsEmpty(text.length === 0);
    handleLifecycleEvent("content-area-key-up");
  };

  // Mouse, keyboard, lifecycle bodies — built in the body, never inline in
  // JSX. ContentArea stays dumb: it just shapes the payload and forwards.
  // SM owns every decision (and every preventDefault).
  // @flowmap-node contentArea__onMouse kind=function
  const handleMouseEvent = (e: React.MouseEvent, trigger: TriggerWord) => {
    const mouseData: MouseEventData = {
      clientX: e.clientX,
      clientY: e.clientY,
      blockId: id,
      blockType: component,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      button: e.button,
      buttons: e.buttons,
      nativeEvent: e,
    };
    cbMouseEvent(mouseData, trigger);
  };

  // @flowmap-node contentArea__onKey kind=function
  const handleKeyboardEvent = (e: React.KeyboardEvent, trigger: TriggerWord) => {
    const keyData: KeyEventData = {
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      blockId: id,
      blockType: component,
      offset: readCaretOffset(contentRef.current),
      nativeEvent: e,
    };
    cbKeyboardEvent(keyData, trigger);
  };

  // @flowmap-node contentArea__onLife kind=function
  const handleLifecycleEvent = (trigger: TriggerWord) => {
    console.log(trigger); //to get around Supabase error
    const el = contentRef.current;
    const lifecycleData: LifecycleEventData = {
      blockId: id,
      blockType: component,
      text: el?.textContent ?? "",
    };
    cbLifecycleEvent(lifecycleData, trigger);
  };

  return (
    <div className="content-area">
      <Tag
        ref={contentRef as React.Ref<never>}
        id={id}
        key={id}
        data-blockid={id}
        data-empty={isEmpty ? "true" : undefined}
        data-placeholder={PLACEHOLDERS[Tag as string] ?? PLACEHOLDERS.p}
        className={classNames}
        contentEditable={true}
        suppressContentEditableWarning={true}
        onInput={handleInput}
        onMouseDown={(event) =>
          handleMouseEvent(event, "content-area-mouse-down")
        }
        onMouseUp={(event) => handleMouseEvent(event, "content-area-mouse-up")}
        onClick={(event) => handleMouseEvent(event, "content-area-mouse-click")}
        onKeyDown={(event) =>
          handleKeyboardEvent(event, "content-area-key-down")
        }
        onKeyUp={(event) => handleKeyboardEvent(event, "content-area-key-up")}
        onBlur={() => handleLifecycleEvent("content-area-blur")}
      >
        {/* @flowmap-node contentArea__recurse kind=function */}
        {children?.map((child) => {
          const childNode = contentDataSet[child];
          return (
            <ContentArea
              activeContent={childNode}
              contentDataSet={contentDataSet}
              cbMouseEvent={cbMouseEvent}
              cbKeyboardEvent={cbKeyboardEvent}
              cbLifecycleEvent={cbLifecycleEvent}
            />
          );
        })}
      </Tag>
    </div>
  );
}
