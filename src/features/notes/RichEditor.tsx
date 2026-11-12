import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Code2, Heading1, Heading2, Italic, List, ListOrdered, Quote, Redo2, Strikethrough, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RichEditor({ html, onChange, docKey }: { html: string; onChange: (html: string, text: string) => void; docKey: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: true, autolink: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } } }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: html,
    editorProps: { attributes: { class: 'prose-lk min-h-[50vh] outline-none', 'aria-label': 'Note content' } },
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.getText()),
  }, [docKey])

  useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return null
  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (label: string, icon: React.ReactNode, run: () => void, active = false) => (
    <button type="button" onClick={run} aria-label={label} title={label} aria-pressed={active}
      className={cn('rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg', active && 'bg-primary-soft text-primary-soft-fg')}>{icon}</button>
  )
  const c = () => editor.chain().focus()
  return (
    <div className="sticky top-16 z-10 -mx-1 mb-3 flex flex-wrap gap-0.5 border-b border-line bg-surface/95 px-1 py-1.5 backdrop-blur">
      {btn('Bold', <Bold className="h-4 w-4" />, () => c().toggleBold().run(), editor.isActive('bold'))}
      {btn('Italic', <Italic className="h-4 w-4" />, () => c().toggleItalic().run(), editor.isActive('italic'))}
      {btn('Strikethrough', <Strikethrough className="h-4 w-4" />, () => c().toggleStrike().run(), editor.isActive('strike'))}
      {btn('Heading 1', <Heading1 className="h-4 w-4" />, () => c().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
      {btn('Heading 2', <Heading2 className="h-4 w-4" />, () => c().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      {btn('Bullet list', <List className="h-4 w-4" />, () => c().toggleBulletList().run(), editor.isActive('bulletList'))}
      {btn('Numbered list', <ListOrdered className="h-4 w-4" />, () => c().toggleOrderedList().run(), editor.isActive('orderedList'))}
      {btn('Quote', <Quote className="h-4 w-4" />, () => c().toggleBlockquote().run(), editor.isActive('blockquote'))}
      {btn('Code block', <Code2 className="h-4 w-4" />, () => c().toggleCodeBlock().run(), editor.isActive('codeBlock'))}
      <span className="mx-1 w-px bg-line" />
      {btn('Undo', <Undo2 className="h-4 w-4" />, () => c().undo().run())}
      {btn('Redo', <Redo2 className="h-4 w-4" />, () => c().redo().run())}
    </div>
  )
}
