let generation = 0

export function advanceLoadGeneration() {
  generation += 1
  return generation
}

export function currentLoadGeneration() {
  return generation
}
