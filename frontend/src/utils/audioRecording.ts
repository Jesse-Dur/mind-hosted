export function recordingBlob(chunks: Blob[], mimeType: string) {
  const type = mimeType || chunks.find((chunk) => chunk.type)?.type || "application/octet-stream"
  return new Blob(chunks, { type })
}

export function recordingFilename(mimeType: string) {
  const type = mimeType.split(";")[0]?.trim().toLowerCase()
  if (type === "audio/mp4" || type === "video/mp4" || type === "audio/x-m4a") return "audio.m4a"
  if (type === "audio/ogg") return "audio.ogg"
  if (type === "audio/webm" || type === "video/webm") return "audio.webm"
  return "audio"
}

type RecordingResult = { chunks: Blob[]; mimeType: string; durationMs: number }
type RecordingCallbacks = {
  onRecording: () => void
  onStop: (result: RecordingResult) => void
  onSilence: () => void
  onError: (error: unknown) => void
}

// Own resources per recording so a late permission result or recorder event
// can never release the microphone belonging to a newer recording.
export function createAudioRecording(callbacks: RecordingCallbacks) {
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let audioContext: AudioContext | null = null
  let silenceTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let cancelled = false
  let started = false
  let startedAt = 0
  const chunks: Blob[] = []

  function release() {
    if (silenceTimer !== null) clearInterval(silenceTimer)
    silenceTimer = null
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    const context = audioContext
    audioContext = null
    if (context && context.state !== "closed") void context.close().catch(() => {})
  }

  function stop() {
    if (stopped) return false
    stopped = true
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
        return true
      }
      return false
    } catch (error) {
      cancelled = true
      callbacks.onError(error)
      return false
    } finally {
      // MediaRecorder.stop() queues its final data/stop events. Release hardware
      // now, while allowing those events to finish assembling the recording.
      release()
    }
  }

  function cancel() {
    cancelled = true
    stop()
  }

  async function start() {
    if (stopped || started) return
    started = true
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (stopped) {
        acquired.getTracks().forEach((track) => track.stop())
        return
      }
      stream = acquired
      const context = new AudioContext()
      audioContext = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let silentMs = 0
      silenceTimer = setInterval(() => {
        analyser.getByteFrequencyData(data)
        const volume = data.reduce((sum, value) => sum + value, 0) / data.length / 255
        silentMs = volume < 0.01 ? silentMs + 100 : 0
        if (silentMs >= 3000) callbacks.onSilence()
      }, 100)

      const mediaRecorder = new MediaRecorder(stream)
      recorder = mediaRecorder
      mediaRecorder.ondataavailable = (event) => {
        if (cancelled || !event.data.size) return
        if (!stopped && !startedAt) {
          startedAt = Date.now()
          callbacks.onRecording()
        }
        chunks.push(event.data)
      }
      mediaRecorder.onstop = () => {
        stopped = true
        release()
        if (!cancelled) callbacks.onStop({
          chunks,
          mimeType: mediaRecorder.mimeType,
          durationMs: startedAt ? Date.now() - startedAt : 0,
        })
      }
      mediaRecorder.onerror = (event) => {
        cancel()
        callbacks.onError(event)
      }
      mediaRecorder.start(50)
    } catch (error) {
      const reportError = !stopped
      cancel()
      if (reportError) callbacks.onError(error)
    }
  }

  return { start, stop, cancel }
}
