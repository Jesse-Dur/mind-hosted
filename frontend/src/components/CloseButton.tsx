interface Props {
  onClick: (e: React.MouseEvent) => void
  size?: number
}

export function CloseButton({ onClick, size = 18 }: Props) {
  return (
    <button
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#ebebeb")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        padding: 0,
        transition: "background 0.15s ease",
      }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1 1l6 6M7 1L1 7" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  )
}
