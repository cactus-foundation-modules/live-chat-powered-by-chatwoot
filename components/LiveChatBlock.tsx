// LiveChatWidget Puck block - editor-safe half. The real per-viewer decision
// (customer widget vs admin agent console) happens in LiveChatBlock.rsc.tsx,
// which needs the session cookie and so cannot be imported from the editor
// bundle. Widget options themselves (label, position, reply-time text) live in
// module settings, not block props - the block is a placement marker.

function EditorPreview() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
      padding: '0.6rem 1rem', borderRadius: '999px',
      background: 'var(--color-accent, #1A5F5A)', color: '#fff',
      fontSize: '0.875rem', fontWeight: 600, margin: '0.5rem',
    }}>
      💬 Live chat bubble (shows bottom corner on the real site)
    </div>
  )
}

export const liveChatBlockComponent = {
  label: 'Live Chat',
  fields: {},
  defaultProps: {},
  render: EditorPreview,
}
