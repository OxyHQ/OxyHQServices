import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WebOxyProvider } from "@oxyhq/auth"
import { Toaster } from "@/components/ui/sonner"

import "./index.css"
import App from "./App.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebOxyProvider baseURL="https://api.oxy.so">
      <App />
      <Toaster />
    </WebOxyProvider>
  </StrictMode>
)
