import { useEffect, useState, useRef } from "react"
import { createAudioRecording, recordingBlob } from "../utils/audioRecording"
import { createApi } from "../api/client"
import { isApiRateLimitError } from "../api/errors"
import { useStore } from "../store"
import type { BillingLimitFeature } from "../types"

type MicState = "idle" | "loading" | "recording" | "transcribing"
type GetToken = () => Promise<string | null>
type RecordingSession = {
  audio: ReturnType<typeof createAudioRecording>
  onTranscript: (text: string) => void
  silent: boolean
  checkDuration: boolean
  stopping: boolean
}

export function useMicRecording(getToken: GetToken, onTranscript: (text: string) => void) {
  const [micState, setMicState] = useState<MicState>("idle")
  const [micError, setMicError] = useState<string | null>(null)
  const sessionRef = useRef<RecordingSession | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function dispose() {
      const session = sessionRef.current
      sessionRef.current = null
      session?.audio.cancel()
      if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current)
    }
    function onPageHide() {
      dispose()
      setMicState("idle")
      setMicError(null)
    }
    window.addEventListener("pagehide", onPageHide)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      dispose()
    }
  }, [])

  function showError(msg: string) {
    setMicError(msg)
    setMicState("idle")
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setMicError(null), 3000)
  }

  function stopRecording(silent = false, onDone?: (text: string) => void) {
    const session = sessionRef.current
    if (!session || session.stopping) return
    session.stopping = true
    session.silent = silent
    if (onDone) {
      session.onTranscript = onDone
      session.checkDuration = false
    }
    setMicState("transcribing")
    if (!session.audio.stop() && sessionRef.current === session) {
      sessionRef.current = null
      setMicState("idle")
    }
  }

  function startRecording() {
    if (sessionRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) return showError("Microphone not supported")
    setMicState("loading")
    setMicError(null)
    const session: RecordingSession = {
      silent: false,
      checkDuration: true,
      stopping: false,
      onTranscript,
      audio: createAudioRecording({
        onRecording: () => {
          if (sessionRef.current === session) setMicState("recording")
        },
        onSilence: () => {
          if (sessionRef.current === session) stopRecording(true)
        },
        onError: (error) => {
          if (sessionRef.current !== session) return
          sessionRef.current = null
          const name = (error as Error).name
          showError(name === "NotAllowedError" ? "Microphone access denied"
            : name === "NotFoundError" ? "No microphone found" : "Microphone unavailable")
        },
        onStop: async ({ chunks, mimeType, durationMs }) => {
          if (sessionRef.current !== session) return
          try {
            if (session.silent) return showError("No sound detected")
            if (session.checkDuration && durationMs < 1000) return showError("Recording too short (min 1 second)")
            const blob = recordingBlob(chunks, mimeType)
            if (blob.size < 1000) return showError("No audio detected")
            setMicState("transcribing")
            const { text } = await createApi(getToken).transcription.transcribe(blob)
            if (sessionRef.current !== session) return
            if (text.trim()) session.onTranscript(text.trim())
            else showError("No speech detected")
          } catch (error: unknown) {
            if (sessionRef.current !== session) return
            if (isApiRateLimitError(error)) {
              useStore.getState().showBillingCreationLimitNotice(error.featureId as BillingLimitFeature, { resetAt: error.resetAt })
              setMicError(null)
            } else showError("Transcription failed")
          } finally {
            if (sessionRef.current === session) {
              sessionRef.current = null
              setMicState("idle")
            }
          }
        },
      }),
    }
    sessionRef.current = session
    void session.audio.start()
  }

  function handleMic() {
    if (micState === "recording") stopRecording()
    else if (micState === "idle") startRecording()
  }

  function cancelRecording() {
    const session = sessionRef.current
    sessionRef.current = null
    session?.audio.cancel()
    setMicState("idle")
    setMicError(null)
  }

  return {
    micState, micError, handleMic, cancelRecording,
    stopForEditing: () => stopRecording(),
    stopAndTranscribe: (onDone: (text: string) => void) => stopRecording(false, onDone),
  }
}
