// La pizarra (Excalidraw) lee de aquí la carpeta de sus fuentes, que Vite copia junto a la app: así no hace falta Internet.
// Tiene que estar puesto antes de que se cargue su código, por eso vive en el punto de entrada.
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/'

// Excalidraw añade a cada fuente una copia de respaldo en https://esm.sh. Aquí no hace falta (y la CSP la bloquearía, además de
// que Nora no debe pedir nada a terceros), así que se descarta esa dirección y solo quedan las locales.
const NativeFontFace = window.FontFace
window.FontFace = class extends NativeFontFace {
  constructor(family: string, source: string | BinaryData, descriptors?: FontFaceDescriptors) {
    super(family, typeof source === 'string' && source.includes('esm.sh') ? source.split(/,\s*(?=url\()/).filter((p) => !p.includes('esm.sh')).join(', ') : source, descriptors)
  }
}

import './canvasFilter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth'
import { AiProvider } from './ai/AiProvider'
import { RealtimeProvider } from './realtime'
import { NotificationsProvider } from './notifications'
import { ThemeProvider } from './theme'
import { ToastProvider } from './toast'
import { DialogProvider } from './dialogs'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
        <AuthProvider>
          <RealtimeProvider>
            <AiProvider>
              <NotificationsProvider>
                <App />
              </NotificationsProvider>
            </AiProvider>
          </RealtimeProvider>
        </AuthProvider>
        </DialogProvider>
      </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
