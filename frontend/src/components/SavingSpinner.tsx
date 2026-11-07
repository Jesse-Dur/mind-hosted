export const SAVING_SPINNER_FADE_MS = 750

export function SavingSpinner({ fading = false, size = 12 }: { fading?: boolean; size?: number }) {
  return (
    <>
      <style>{`@keyframes mindSavingSpin { to { transform: rotate(360deg) } } @keyframes savingFadeIn { from { opacity: 0 } to { opacity: 1 } } @keyframes savingFadeOut { 0%,20% { opacity: 1 } 100% { opacity: 0 } }`}</style>
      <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" style={{ display: "block", flexShrink: 0, animation: `mindSavingSpin 0.7s linear infinite, ${fading ? `savingFadeOut ${SAVING_SPINNER_FADE_MS}ms ease forwards` : "savingFadeIn 0.2s ease"}` }}>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="#ddd" strokeWidth="1.5"/>
        <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" fill="none" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </>
  )
}
