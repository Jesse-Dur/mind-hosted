export function SavingSpinner() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes savingFadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      <svg width="12" height="12" viewBox="0 0 12 12" style={{ flexShrink: 0, animation: "spin 0.7s linear infinite, savingFadeIn 0.2s ease" }}>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="#ddd" strokeWidth="1.5"/>
        <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" fill="none" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </>
  )
}
