import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Editor } from '@tiptap/react'
import { MarkButton } from '../../vendor/tiptap-ui/components/tiptap-ui/mark-button'
import { UndoRedoButton } from '../../vendor/tiptap-ui/components/tiptap-ui/undo-redo-button'
import { LinkPopover } from '../../vendor/tiptap-ui/components/tiptap-ui/link-popover'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '../../vendor/tiptap-ui/components/tiptap-ui-primitive/toolbar'
import { Button } from '../../vendor/tiptap-ui/components/tiptap-ui-primitive/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../vendor/tiptap-ui/components/tiptap-ui-primitive/popover'
import { BanIcon } from '../../vendor/tiptap-ui/components/tiptap-icons/ban-icon'
import { useTiptapEditor } from '../../vendor/tiptap-ui/hooks/use-tiptap-editor'
import { TEXT_COLORS } from '@xivstrat/content-schema'
import '../../vendor/tiptap-ui/styles/_variables.scss'
import '../../vendor/tiptap-ui/styles/_keyframe-animations.scss'
import './toolbar.scss'

const colorLabels = ['红色', '黄色', '绿色', '蓝色', '紫色']
const preserveSelection = (event: React.MouseEvent<HTMLButtonElement>): void => event.preventDefault()
function ColorPopover({ editor }: { editor: Editor }): React.JSX.Element {
  useTiptapEditor(editor)
  const [open, setOpen] = React.useState(false)
  const color = editor.getAttributes('textStyle').color as string | null
  const setColor = (color: string | null): void => {
    editor.chain().focus().setMark('textStyle', { color }).run()
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          aria-label="颜色"
          tooltip="文字颜色"
          tabIndex={-1}
          onMouseDown={preserveSelection}
        >
          <span
            className="text-color-icon"
            aria-hidden="true"
            style={{ borderBottomColor: color || 'currentColor' }}
          >
            A
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="richtext-colors" aria-label="文字颜色">
        <p className="richtext-popover-label">文字颜色</p>
        <div className="richtext-color-grid">
          <Button
            type="button"
            data-style="ghost"
            aria-label="默认色"
            tooltip="默认色"
            onClick={() => setColor(null)}
            data-active-state={!color ? 'on' : 'off'}
          >
            <BanIcon className="tiptap-button-icon" />
          </Button>
          {TEXT_COLORS.map((value, index) => (
            <Button
              key={value}
              type="button"
              data-style="ghost"
              aria-label={colorLabels[index]}
              tooltip={colorLabels[index]}
              data-active-state={color === value ? 'on' : 'off'}
              onClick={() => setColor(value)}
            >
              <span className="richtext-swatch" style={{ backgroundColor: value }} />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
function BodyToolbar({ editor }: { editor: Editor }): React.JSX.Element {
  return (
    <Toolbar aria-label="正文格式" className="body-toolbar">
      <ToolbarGroup aria-label="历史记录">
        <UndoRedoButton
          editor={editor}
          action="undo"
          aria-label="撤销"
          tooltip="撤销"
          onMouseDown={preserveSelection}
        />
        <UndoRedoButton
          editor={editor}
          action="redo"
          aria-label="重做"
          tooltip="重做"
          onMouseDown={preserveSelection}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="文字格式">
        <MarkButton
          editor={editor}
          type="bold"
          aria-label="加粗"
          tooltip="加粗"
          onMouseDown={preserveSelection}
        />
        <MarkButton
          editor={editor}
          type="italic"
          aria-label="斜体"
          tooltip="斜体"
          onMouseDown={preserveSelection}
        />
        <MarkButton
          editor={editor}
          type="underline"
          aria-label="下划线"
          tooltip="下划线"
          onMouseDown={preserveSelection}
        />
        <MarkButton
          editor={editor}
          type="strike"
          aria-label="删除线"
          tooltip="删除线"
          onMouseDown={preserveSelection}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup aria-label="链接和颜色">
        <LinkPopover
          editor={editor}
          aria-label="超链接"
          tooltip="超链接"
          autoOpenOnLinkActive={false}
          onMouseDown={preserveSelection}
        />
        <ColorPopover editor={editor} />
        <Button
          type="button"
          data-style="ghost"
          aria-label="清除格式"
          tooltip="清除格式"
          tabIndex={-1}
          onMouseDown={preserveSelection}
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        >
          <BanIcon className="tiptap-button-icon" />
        </Button>
      </ToolbarGroup>
    </Toolbar>
  )
}
export function mountBodyToolbar(host: HTMLElement, editor: Editor): Root {
  const root = createRoot(host)
  root.render(<BodyToolbar editor={editor} />)
  return root
}
