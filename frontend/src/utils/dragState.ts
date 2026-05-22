// Module-level state shared across all Tile instances
export const dragState = {
  thoughtId: null as number | null,
  sourceTileId: null as number | null,
  clearDragging: null as (() => void) | null,
}
