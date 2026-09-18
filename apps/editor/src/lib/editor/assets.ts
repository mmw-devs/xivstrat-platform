import type { ElementLookup } from '../ui/dom'
import type { BodyEditorHandle } from '../richtext/editor'
import { mountBannerUpload } from './banner-upload'
import { mountImageLibrary } from './image-library'
import { mountGameSearch } from './game-search'
export function mountAssets(byId: ElementLookup, getInsertionTarget: () => { body?: BodyEditorHandle; input?: HTMLInputElement | HTMLTextAreaElement }, signal: AbortSignal): void {
  mountBannerUpload(byId, signal)
  const library = mountImageLibrary(byId, signal)
  mountGameSearch(byId, getInsertionTarget, library.addIcon, signal)
}
