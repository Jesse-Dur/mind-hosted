import { lazy, Suspense, useLayoutEffect } from "react"
import { useMobileWorkspace } from "./useWorkspaceLayout"

const DesktopWorkspace = lazy(() => import("./desktop/DesktopWorkspace"))
const MobileWorkspace = lazy(() => import("./mobile/MobileWorkspace"))

function WorkspaceCommitSignal({ onReady }: { onReady: () => void }) {
  // This component lives inside the same Suspense boundary as the lazy
  // workspace. Its layout effect cannot run until that workspace has loaded
  // and committed, so the static splash always has real UI behind its fade.
  useLayoutEffect(onReady, [onReady])
  return null
}

export function ResponsiveWorkspace({ onReady }: { onReady: () => void }) {
  const mobile = useMobileWorkspace()
  return (
    <Suspense fallback={null}>
      {mobile ? <MobileWorkspace /> : <DesktopWorkspace />}
      <WorkspaceCommitSignal onReady={onReady} />
    </Suspense>
  )
}
