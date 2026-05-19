# FEATURES.md — Dashboard Feature List

## Canvas
- Blank page with dot grid (dots at grid corners, subtle)
- Click empty space to create a new tile at cursor position
- No big title bars or chrome — very modern and clean
- Tiles are absolutely positioned, freeform placement
- Tiles are draggable and resizable
- Auto-snap to grid but mostly freeform

## Tiles
- Each tile has a name/category
- Tiles have an importance level
- Tiles can be shown/hidden based on time of day
- "What I'm doing at the moment" tile type
- Hide specific tiles by context (e.g. hide school/work tiles)
- Track "current projects" and "last doing what"
- Tile for unorganised "thoughts" — a forced default catch-all tile ("To Deal With Later")

## Thoughts
- All pieces of text/notes are called "thoughts"
- Thoughts are dot points within a tile
- Thoughts can be tagged (e.g. "follow up", person's name, project name)
- Thoughts are searchable
- Thoughts have timestamps
- "Message person" tag type for follow-up items

## Tags
- Thoughts can have multiple tags
- Tags include: follow up, person name, project, and custom
- Tags are searchable via Spotlight

## Spotlight
- Cmd-based keyboard shortcut to open spotlight view (e.g. cmd+T)
- Fuzzy search across all thoughts, tiles, and tags
- Highlights/jumps to the relevant tile when a result is selected
- Fast, keyboard-driven

## AI / Ollama Integration
- Uses local Ollama instance at localhost:11434 — not deployed, just called
- Voice/text input via a text field (populated by Apple dictation or Voiceover app)
- LLM processes input and decides: which tile it belongs to, what tags to apply
- LLM creates a new thought (dot point) in the correct tile automatically
- Processing queue with priority levels: low, medium, high
  - Low: unnoticeable background processing
  - Medium: moderate concurrency
  - High: aggressive concurrent processing
- Voice/text inputs saved with timestamps for history view
- All voice files stored with timestamps for a history/audit view
- For each voice file ("event") have the:
  - Transcription, then
  - Actions that were asked (as interpreted by the LLM)
  - Actions taken, e.g. added x thought to y tile tagged with z. 

## Input
- Text field for typed or dictated input
- Input sent to Ollama for classification and routing
- Ollama response creates/updates thoughts and tags automatically

## Show / Hide
- Tiles can be shown or hidden based on time of day
- "Deal with later" mode — unorganised thoughts go to a default catch-all tile
- Thoughts in catch-all tile are unorganised until processed

## Future Features
- Mark a tile as the default "random thoughts" destination for uncertain AI inputs
- AI thinking indicator — subtle UI element showing when AI is processing, with option to expand and see the full thinking loop (tool calls, search results, iterations)

- Very small, compartmentalised files — no file over ~80 lines
- One file per responsibility
- No big multi-hundred or thousand line files
