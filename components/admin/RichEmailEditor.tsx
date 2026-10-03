'use client'

import { useEffect, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link2, Table2, Undo2, Redo2,
  Heading2, Heading3, Rows3, Columns3, Trash2,
} from 'lucide-react'
import {
  OEM_PLACEHOLDERS, OEM_SAMPLE_VALUES, STARTER_TEMPLATE_HTML, isHtmlTemplate, plainToHtml, renderHtmlEmail,
} from '@/lib/email/oem-template'

const COLORS = [
  { label: 'Black', value: '#222222' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Green', value: '#15803d' },
]

function toEditorHtml(value: string): string {
  return isHtmlTemplate(value) ? value : plainToHtml(value)
}

function Btn({ title, active, disabled, onClick, children }: {
  title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md text-foreground transition-colors disabled:opacity-30 ${
        active ? 'bg-primary/15 text-primary' : 'hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />
}

function Toolbar({ editor }: { editor: Editor }) {
  const inTable = editor.isActive('table')
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link address (https://…) — leave empty to remove', previous ?? 'https://')
    if (url === null) return
    if (url.trim() === '' || url.trim() === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
      <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="h-3.5 w-3.5" /></Btn>
      <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="h-3.5 w-3.5" /></Btn>
      <Divider />
      <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-3.5 w-3.5" /></Btn>
      <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-3.5 w-3.5" /></Btn>
      <Btn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-3.5 w-3.5" /></Btn>
      <Btn title="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-3.5 w-3.5" /></Btn>
      <Btn title="Sub-heading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 className="h-3.5 w-3.5" /></Btn>
      <Divider />
      {COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          title={`Text colour: ${c.label}`}
          aria-label={`Text colour: ${c.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setColor(c.value).run()}
          className="grid h-7 w-6 place-items-center rounded-md hover:bg-muted"
        >
          <span className="h-3.5 w-3.5 rounded-full border border-border" style={{ backgroundColor: c.value }} />
        </button>
      ))}
      <Divider />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-3.5 w-3.5" /></Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-3.5 w-3.5" /></Btn>
      <Btn title="Link" active={editor.isActive('link')} onClick={setLink}><Link2 className="h-3.5 w-3.5" /></Btn>
      <Divider />
      <Btn title="Insert table (3 rows × 2 columns)" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run()}><Table2 className="h-3.5 w-3.5" /></Btn>
      <Btn title="Add row below" disabled={!inTable} onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="h-3.5 w-3.5" /></Btn>
      <Btn title="Add column to the right" disabled={!inTable} onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="h-3.5 w-3.5" /></Btn>
      <Btn title="Make cell a label (shaded header cell) or back to normal" disabled={!inTable} onClick={() => editor.chain().focus().toggleHeaderCell().run()}>
        <span className="text-[10px] font-bold">TH</span>
      </Btn>
      <Btn title="Delete row" disabled={!inTable} onClick={() => editor.chain().focus().deleteRow().run()}><span className="text-[10px] font-bold">−R</span></Btn>
      <Btn title="Delete column" disabled={!inTable} onClick={() => editor.chain().focus().deleteColumn().run()}><span className="text-[10px] font-bold">−C</span></Btn>
      <Btn title="Delete table" disabled={!inTable} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-3.5 w-3.5" /></Btn>
    </div>
  )
}

export default function RichEmailEditor({ label, value, onChange, hint }: {
  label: string
  value: string
  onChange: (html: string) => void
  hint?: string
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      TextStyle,
      Color,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: { class: 'oem-editor-body min-h-[260px] px-4 py-3 text-sm focus:outline-none' },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.isEmpty ? '' : ed.getHTML()),
  })

  // When the form is pointed at another OEM (or reset), load that value without echoing it back.
  useEffect(() => {
    if (!editor) return
    const wanted = toEditorHtml(value)
    if (!editor.isFocused && wanted !== editor.getHTML() && !(wanted === '' && editor.isEmpty)) {
      editor.commands.setContent(wanted, { emitUpdate: false })
    }
  }, [value, editor])

  const previewHtml = renderHtmlEmail(toEditorHtml(value) || '<p></p>', OEM_SAMPLE_VALUES).html

  return (
    <div>
      <style>{`
        .oem-editor-body table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .oem-editor-body th, .oem-editor-body td { border: 1px solid #cbd5e1; padding: 6px 10px; vertical-align: top; min-width: 60px; }
        .oem-editor-body th { background: #f1f5f9; text-align: left; font-weight: 700; }
        .oem-editor-body p { margin: 0 0 8px; }
        .oem-editor-body ul { list-style: disc; padding-left: 22px; margin: 0 0 8px; }
        .oem-editor-body ol { list-style: decimal; padding-left: 22px; margin: 0 0 8px; }
        .oem-editor-body h2 { font-size: 17px; font-weight: 700; margin: 0 0 8px; }
        .oem-editor-body h3 { font-size: 15px; font-weight: 700; margin: 0 0 8px; }
        .oem-editor-body a { color: #1d4ed8; text-decoration: underline; }
        .oem-editor-body .selectedCell { background: #dbeafe; }
        .oem-preview table { border-collapse: collapse; }
      `}</style>

      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {(['edit', 'preview'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold ${mode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
            >
              {m === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {mode === 'edit' && editor && (
          <>
            <Toolbar editor={editor} />
            <EditorContent editor={editor} />
          </>
        )}
        {mode === 'edit' && !editor && <div className="min-h-[300px] px-4 py-3 text-xs text-muted-foreground">Loading editor…</div>}
        {mode === 'preview' && (
          <div className="oem-preview min-h-[300px] bg-white p-4 text-neutral-900">
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
              Preview with sample ticket details — this is how the email will look.
            </p>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Insert detail:</span>
        {OEM_PLACEHOLDERS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!editor || mode !== 'edit'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().insertContent(`{{${p}}}`).run()}
            className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-muted disabled:opacity-40"
          >
            {`{{${p}}}`}
          </button>
        ))}
        <button
          type="button"
          disabled={!editor || mode !== 'edit'}
          onClick={() => {
            if (value.trim() && !window.confirm('Replace the current body with the starter table layout?')) return
            editor?.commands.setContent(STARTER_TEMPLATE_HTML, { emitUpdate: true })
          }}
          className="ml-auto rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40"
        >
          Use starter table layout
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
