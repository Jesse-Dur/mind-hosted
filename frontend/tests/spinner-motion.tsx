import { SavingSpinner } from "../src/components/SavingSpinner"
import { MicButton } from "../src/components/MicButton"

export function SpinnerMotionFixture() {
  return <main style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
    {[false, true].flatMap((fading) => [7, 12, 22, 33].map((size) => <div key={`${fading}:${size}`} style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <span style={{ width: 160 }}>{size}px · {fading ? "fading" : "pending"}</span>
      <div data-spinner-motion={`${size}:${fading}`} style={{ width: 52, height: 52, display: "grid", placeItems: "center", background: "#fafafa", border: "1px solid #ddd" }}><SavingSpinner size={size} fading={fading} /></div>
    </div>))}
    <div data-spinner-motion="scaled" style={{ transform: "scale(.73)", transformOrigin: "top left", width: 52, height: 52, display: "grid", placeItems: "center" }}><SavingSpinner size={33} /></div>
    <div data-spinner-motion="microphone"><MicButton micState="transcribing" onMicClick={() => {}} /></div>
  </main>
}

export async function runSpinnerMotionChecks() {
  const results: { test: string; passed: boolean }[] = []
  const check = (test: string, passed: boolean) => results.push({ test, passed })
  const project = (element: SVGGraphicsElement, x: number, y: number) => new DOMPoint(x, y).matrixTransform(element.getScreenCTM()!)
  const near = (a: number, b: number) => Math.abs(a - b) < 0.02
  const samples = [...document.querySelectorAll<HTMLElement>("[data-spinner-motion]")].map((sample) => {
    const svg = sample.querySelector<SVGSVGElement>("svg")!
    const track = svg.querySelector("circle")!
    const arc = svg.querySelector("path")!
    const animations = svg.getAnimations({ subtree: true }) as CSSAnimation[]
    for (const animation of animations) {
      animation.pause()
      animation.currentTime = animation.animationName === "mindSavingSpin" ? 0 : 200
    }
    return { name: sample.dataset.spinnerMotion!, svg, track, arc, animations }
  })
  await new Promise(requestAnimationFrame)
  for (const { name, svg, track, arc, animations } of samples) {
    const before = svg.getBoundingClientRect()
    const trackMatrix = track.getScreenCTM()!
    const expectedCenter = project(svg, 6, 6)
    const positions: DOMPoint[] = []
    let fixedBox = true, fixedTrack = true, fixedCenter = true, circularPath = true
    for (let phase = 0; phase < 8; phase += 1) {
      for (const animation of animations) {
        if (animation.animationName === "mindSavingSpin") animation.currentTime = phase * 700 / 8
      }
      await new Promise(requestAnimationFrame)
      const rect = svg.getBoundingClientRect()
      fixedBox &&= ["x", "y", "width", "height"].every((key) => near(rect[key as keyof DOMRect] as number, before[key as keyof DOMRect] as number))
      const matrix = track.getScreenCTM()!
      fixedTrack &&= (["a", "b", "c", "d", "e", "f"] as const).every((key) => near(matrix[key], trackMatrix[key]))
      const center = project(arc, 6, 6)
      fixedCenter &&= near(center.x, expectedCenter.x) && near(center.y, expectedCenter.y)
      const position = project(arc, 6, 1.5)
      const angle = phase * Math.PI / 4
      const expected = project(svg, 6 + 4.5 * Math.sin(angle), 6 - 4.5 * Math.cos(angle))
      circularPath &&= near(position.x, expected.x) && near(position.y, expected.y)
      positions.push(position)
    }
    check(`${name}: SVG bounds stay fixed through a full turn`, fixedBox)
    check(`${name}: grey track stays stationary`, fixedTrack)
    check(`${name}: arc rotates about the ring centre`, fixedCenter)
    check(`${name}: arc follows the ring at every sampled angle`, circularPath)
    check(`${name}: arc actually moves`, Math.hypot(positions[0]!.x - positions[4]!.x, positions[0]!.y - positions[4]!.y) > 1)
  }
  for (const { animations } of samples) for (const animation of animations) animation.play()
  return results
}
