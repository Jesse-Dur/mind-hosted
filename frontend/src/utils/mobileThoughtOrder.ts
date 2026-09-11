export type ThoughtRowBounds = {
  id: number
  top: number
  bottom: number
}

export function mobileThoughtInsertionIndex(rows: ThoughtRowBounds[], draggedId: number, clientY: number) {
  const availableRows = rows.filter((row) => row.id !== draggedId)
  const beforeIndex = availableRows.findIndex((row) => clientY < row.top + (row.bottom - row.top) / 2)
  return beforeIndex === -1 ? availableRows.length : beforeIndex
}

export function mobileThoughtOrderIds(ids: number[], draggedId: number, insertionIndex: number) {
  const remaining = ids.filter((id) => id !== draggedId)
  const next = [...remaining]
  const clampedIndex = Math.max(0, Math.min(insertionIndex, next.length))
  next.splice(clampedIndex, 0, draggedId)
  return next
}

export function sameThoughtOrder(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}
