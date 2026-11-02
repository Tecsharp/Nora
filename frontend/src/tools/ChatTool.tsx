import ChatApp from '../chat/ChatApp'
import type { FocusTarget } from './focus'

/** La herramienta Chat: la vista completa con todas las conversaciones, los grupos y sus ajustes. */
export default function ChatTool({ focus, urlConv, onUrlConv }: { focus?: FocusTarget | null; urlConv?: string; onUrlConv?: (id: string | null) => void }) {
  return <ChatApp focus={focus} urlConv={urlConv} onUrlConv={onUrlConv} />
}
