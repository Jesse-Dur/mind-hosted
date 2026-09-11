type SelectionDocument = Pick<Document, "addEventListener" | "removeEventListener">
type SelectionBody = { style: Pick<CSSStyleDeclaration, "userSelect" | "webkitUserSelect"> }
type ClearableSelection = Pick<Selection, "removeAllRanges">

/**
 * Mobile browsers may start their native text-selection gesture while a tile
 * hold is still being recognised. Lock selection for the complete pointer
 * gesture so selection handles cannot steal the drag or hit the split divider.
 */
export function suppressNativeSelection(
  owner: SelectionDocument = document,
  body: SelectionBody = document.body,
  selection: ClearableSelection | null = window.getSelection(),
) {
  const previousUserSelect = body.style.userSelect
  const previousWebkitUserSelect = body.style.webkitUserSelect
  const preventSelection = (event: Event) => event.preventDefault()
  let released = false

  selection?.removeAllRanges()
  body.style.userSelect = "none"
  body.style.webkitUserSelect = "none"
  owner.addEventListener("selectstart", preventSelection, true)

  return () => {
    if (released) return
    released = true
    owner.removeEventListener("selectstart", preventSelection, true)
    body.style.userSelect = previousUserSelect
    body.style.webkitUserSelect = previousWebkitUserSelect
    selection?.removeAllRanges()
  }
}
