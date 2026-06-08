const tileMoveVersions = new Map<number, number>()
const thoughtMoveVersions = new Map<number, number>()

function nextMoveVersion(versions: Map<number, number>, id: number) {
  const version = (versions.get(id) ?? 0) + 1
  versions.set(id, version)
  return version
}

function isLatestMove(versions: Map<number, number>, id: number, version: number) {
  return versions.get(id) === version
}

function clearLatestMove(versions: Map<number, number>, id: number, version: number) {
  if (isLatestMove(versions, id, version)) versions.delete(id)
}

export function nextTileMoveVersion(id: number) {
  return nextMoveVersion(tileMoveVersions, id)
}

export function isLatestTileMove(id: number, version: number) {
  return isLatestMove(tileMoveVersions, id, version)
}

export function clearLatestTileMove(id: number, version: number) {
  clearLatestMove(tileMoveVersions, id, version)
}

export function nextThoughtMoveVersion(id: number) {
  return nextMoveVersion(thoughtMoveVersions, id)
}

export function isLatestThoughtMove(id: number, version: number) {
  return isLatestMove(thoughtMoveVersions, id, version)
}

export function clearLatestThoughtMove(id: number, version: number) {
  clearLatestMove(thoughtMoveVersions, id, version)
}
