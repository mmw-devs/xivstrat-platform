/** Order belongs to application state, independent of DOM wrappers and CSS classes. */
export function createOrderedList<T>() {
  const items: T[] = []
  return {
    values: (): readonly T[] => [...items],
    add(item: T): void { items.push(item) },
    remove(item: T): boolean {
      const index = items.indexOf(item)
      if (index < 0) return false
      items.splice(index, 1)
      return true
    },
    move(item: T, direction: -1 | 1): boolean {
      const index = items.indexOf(item)
      const next = index + direction
      if (index < 0 || next < 0 || next >= items.length) return false
      items.splice(index, 1)
      items.splice(next, 0, item)
      return true
    },
  }
}
