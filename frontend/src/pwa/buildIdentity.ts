export function respondToBuildQuery(event: Pick<MessageEvent, "data" | "ports">, cache: string | null) {
  if (event.data?.type !== "MIND_BUILD_QUERY") return
  event.ports[0]?.postMessage({ cache })
  event.ports[0]?.close()
}
