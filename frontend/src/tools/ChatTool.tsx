import ChatApp from '../chat/ChatApp'
import type { FocusTarget } from './focus'

/** La herramienta Chat: la vista completa con todas las conversaciones, los grupos y sus ajustes. */
export default function ChatTool({ focus }: { focus?: FocusTarget | null }) {
  return <ChatApp focus={focus} />
}
