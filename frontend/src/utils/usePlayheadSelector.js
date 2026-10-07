import { useEffect, useRef, useState } from 'react';
import { subscribePlayhead, getPlayhead } from './playheadBus';

/**
 * Reads a value derived from the playhead (e.g. "which cue is under it") and re-renders the caller only when that
 * value changes, not on every frame the playhead moves. Pass `null` as the selector to skip subscribing.
 * `deps` are the outside values the selector reads; when they change the value is recomputed straight away.
 */
export function usePlayheadSelector(selector, deps = []) {
  const [value, setValue] = useState(() => (selector ? selector(getPlayhead()) : null));
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const valueRef = useRef(value);
  const enabled = Boolean(selector);

  useEffect(() => {
    const apply = (next) => {
      if (Object.is(next, valueRef.current)) return;
      valueRef.current = next;
      setValue(next);
    };
    if (!enabled) { apply(null); return undefined; }
    return subscribePlayhead((t) => {
      // The selector can turn off in a render that hasn't committed yet; skip until this subscription is torn down
      const select = selectorRef.current;
      if (select) apply(select(t));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return value;
}
