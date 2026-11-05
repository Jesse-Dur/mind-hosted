import type { CSSProperties, MouseEventHandler, ReactNode } from "react"
import type { Thought } from "../../types"
import { optimisticIdentityKey } from "../../utils/optimisticIdentity"
import { SyncAnimatedList } from "../../components/SyncAnimatedList"

const keyFor = (thought: Thought) => optimisticIdentityKey(thought, "thought")

type Props = {
  thoughts: Thought[]
  scopeKey: string
  remoteRevision: number
  disabled: boolean
  preview?: boolean
  style: CSSProperties
  renderThought: (thought: Thought) => ReactNode
  footer?: ReactNode
  onClick?: MouseEventHandler<HTMLDivElement>
}

export function MobileThoughtList({ thoughts, renderThought, footer, preview, ...props }: Props) {
  const items = thoughts.map((thought) => ({ key: keyFor(thought), content: renderThought(thought) }))
  if (footer) items.push({ key: "footer", content: footer })
  return <SyncAnimatedList {...props} items={items} data-mobile-thought-list={preview ? undefined : true} />
}

export function ThoughtPreviewBar({ thought }: { thought: Thought }) {
  // A bar keeps its width as it changes position, making reorders readable.
  let hash = 0
  for (const char of keyFor(thought)) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return <div style={{ height: 15, width: `${78 - Math.abs(hash % 3) * 9}%`, borderRadius: 5, background: "linear-gradient(90deg,#e8e8e8,#f2f2f2,#e8e8e8)" }} />
}
