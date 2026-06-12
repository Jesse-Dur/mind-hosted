import { useState, useEffect, useRef } from "react"
import { useStore } from "../store"
import type { Thought } from "../types"

export function useThoughtEdit(thought: Thought) {
  const { updateThoughtContent } = useStore()
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(thought.content)
  const intentToEdit = useRef(false)

  useEffect(() => {
    if (!editing) setContent(thought.content)
  }, [thought.content, editing])

  function startEditing() {
    if (!intentToEdit.current) return
    setEditing(true)
  }

  function setIntent() {
    intentToEdit.current = true
  }

  function cancelEditing() {
    intentToEdit.current = false
    setEditing(false)
    setContent(thought.content)
  }

  function saveEditing(text: string) {
    intentToEdit.current = false
    const trimmed = text.trim()
    setContent(trimmed || thought.content)
    setEditing(false)
    if (trimmed && trimmed !== thought.content) {
      void updateThoughtContent(thought.id, trimmed)
    }
  }

  return { editing, content, saveEditing, startEditing, setIntent, cancelEditing }
}
