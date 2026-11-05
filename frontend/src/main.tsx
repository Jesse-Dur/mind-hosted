import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClerkProvider } from "@clerk/clerk-react"
import App from "./App"
import { registerServiceWorker } from "./pwa/serviceWorker"
import { initializeInstallPrompt } from "./pwa/installPrompt"

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!publishableKey) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set")

registerServiceWorker()
initializeInstallPrompt()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>
)
