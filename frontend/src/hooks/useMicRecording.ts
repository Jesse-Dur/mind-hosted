import { useState, useRef } from "react"
import { createApi } from "../api/client"

type MicState = "idle" | "loading" | "recording" | "transcribing"
type GetToken = () => Promise<string | null>

export function useMicRecording(getToken: GetToken, onTranscript: (text: string) => void) {
  const [micState, setMicState] = useState<MicState>("idle")
  const [micError, setMicError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const silentStopRef = useRef(false)
  const recordingStartRef = useRef<number>(0)

  function showError(msg: string) {
    setMicError(msg)
    setMicState("idle")
    setTimeout(() => setMicError(null), 3000)
  }

  function stopRecording(silent = false) {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
    silentStopRef.current = silent
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
      if (!silent) setMicState("transcribing")
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return showError("Microphone not supported")
    console.log("[mic] requesting getUserMedia...")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: unknown) {
      const name = (e as Error).name
      console.log("[mic] error:", name, e)
      if (name === "NotAllowedError") return showError("Microphone access denied")
      if (name === "NotFoundError") return showError("No microphone found")
      return showError("Microphone unavailable")
    }

    const audioCtx = new AudioContext()
    audioContextRef.current = audioCtx
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    let silentMs = 0

    silenceTimerRef.current = setInterval(() => {
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255
      if (avg < 0.01) {
        silentMs += 100
        if (silentMs >= 3000) stopRecording(true)
      } else {
        silentMs = 0
      }
    }, 100)

    audioChunksRef.current = []
    silentStopRef.current = false
    const recorder = new MediaRecorder(stream)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
    recorder.onstop = async () => {
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
      audioCtx.close()
      stream.getTracks().forEach((t) => t.stop())
      if (silentStopRef.current) {
        silentStopRef.current = false
        return showError("No sound detected")
      }
      const durationMs = Date.now() - recordingStartRef.current
      if (durationMs < 2000) return showError("Recording too short (min 2 seconds)")
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
      if (blob.size < 1000) return showError("No audio detected")
      setMicState("transcribing")
      try {
        const { text } = await createApi(getToken).whisper.transcribe(blob)
        if (text.trim()) onTranscript(text.trim())
        else showError("No speech detected")
      } catch {
        showError("Transcription failed")
      } finally {
        setMicState("idle")
      }
    }

    recorder.start(100)
    recordingStartRef.current = Date.now()
    setMicState("recording")
  }

  function handleMic() {
    if (micState === "recording") stopRecording()
    else if (micState === "idle") {
      setMicState("loading")
      startRecording()
    }
  }

  function cancelRecording() {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
    silentStopRef.current = true
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop()
    audioContextRef.current?.close()
    setMicState("idle")
    setMicError(null)
  }

  function stopForEditing() {
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
    silentStopRef.current = false
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
      setMicState("transcribing")
    } else {
      setMicState("idle")
    }
  }

  // stops recording and calls onDone with the transcribed text for immediate send
  function stopAndTranscribe(onDone: (text: string) => void) {
    if (mediaRecorderRef.current?.state !== "recording") return
    if (silenceTimerRef.current) clearInterval(silenceTimerRef.current)
    const recorder = mediaRecorderRef.current
    recorder.onstop = async () => {
      audioContextRef.current?.close()
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
      if (blob.size < 1000) { showError("No audio detected"); return }
      setMicState("transcribing")
      try {
        const { text } = await createApi(getToken).whisper.transcribe(blob)
        if (text.trim()) onDone(text.trim())
        else showError("No speech detected")
      } catch {
        showError("Transcription failed")
      } finally {
        setMicState("idle")
      }
    }
    recorder.stop()
  }

  return { micState, micError, handleMic, cancelRecording, stopForEditing, stopAndTranscribe }
}
