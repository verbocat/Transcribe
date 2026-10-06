/** Single source of truth for the shortcuts reference (Settings → Shortcuts, Help menu). */
export const SHORTCUT_GROUPS = [
  {
    title: 'Playback',
    items: [
      { keys: 'Space', label: 'Play / pause' },
      { keys: '← / →', label: 'Seek back / forward (step set in Settings → Editor)' },
      { keys: ', / .', label: 'Previous / next frame' },
      { keys: 'L', label: 'Loop the selected subtitle' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: 'Ctrl+Z', label: 'Undo' },
      { keys: 'Ctrl+Y', alt: 'Ctrl+Shift+Z', label: 'Redo' },
      { keys: 'Delete', label: 'Delete the selected subtitle' },
      { keys: 'Ctrl+Space', alt: 'Ctrl+Enter', label: 'Move selected and following subtitles to the playhead' },
      { keys: 'Ctrl+B / I / U', label: 'Bold / italic / underline while typing' },
      { keys: '↑ / ↓', label: 'Previous / next subtitle (when not typing)' },
    ],
  },
  {
    title: 'Find and navigate',
    items: [
      { keys: 'Ctrl+F', label: 'Search the subtitle list' },
      { keys: 'Ctrl+H', label: 'Find and replace' },
      { keys: 'Ctrl+G', label: 'Go to subtitle number or time' },
      { keys: 'F8', label: 'Jump to the next QC issue' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { keys: 'Ctrl+K', label: 'Command palette: search every command' },
      { keys: 'Ctrl+,', label: 'Open Settings' },
      { keys: 'Ctrl+Shift+L', label: 'Open Settings → Layout' },
      { keys: 'Alt+1 … Alt+9', label: 'Switch to a layout preset' },
      { keys: 'Ctrl+S', label: 'Save a local draft now' },
      { keys: 'Ctrl+E', label: 'Export subtitles' },
    ],
  },
  {
    title: 'Timeline',
    items: [
      { keys: 'Drag the ruler', label: 'Scrub' },
      { keys: 'Drag subtitle edges', label: 'Trim in / out points' },
      { keys: 'Shift+drag', label: 'Add a subtitle over the dragged range' },
      { keys: 'Right-click', label: 'Context actions: split, merge, delete' },
    ],
  },
];
