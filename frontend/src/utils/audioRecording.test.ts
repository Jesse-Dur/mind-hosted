import { expect, test } from "bun:test"
import { recordingBlob, recordingFilename } from "./audioRecording"

test.each([
  ["audio/webm;codecs=opus", "audio.webm"],
  ["audio/mp4;codecs=mp4a.40.2", "audio.m4a"],
  ["audio/ogg;codecs=opus", "audio.ogg"],
])("preserves %s bytes, MIME type and upload extension", async (mime, filename) => {
  const audio = recordingBlob([new Blob(["first"]), new Blob(["second"])], mime!)
  expect(await audio.text()).toBe("firstsecond")
  expect(audio.type).toBe(mime!)
  expect(recordingFilename(audio.type)).toBe(filename!)
})

test("falls back to the chunk's actual format rather than assuming WebM", () => {
  const audio = recordingBlob([new Blob(["audio"], { type: "audio/mp4" })], "")
  expect(audio.type).toBe("audio/mp4")
  expect(recordingFilename(audio.type)).toBe("audio.m4a")
})
