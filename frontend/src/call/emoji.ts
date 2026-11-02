import { useCallback, useState } from 'react'
import { REACTIONS } from './api'

/** Todos los emojis que ofrece la ventana de reacciones, por categorías. */
export const EMOJI_GROUPS: { id: string; label: string; list: string[] }[] = [
  { id: 'faces', label: 'Caras', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖'.split(' ') },
  { id: 'hands', label: 'Gestos', list: '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 👏 🙌 👐 🤲 🙏 💪 🦾 ✍️ 🤳 💅 🫶 🫡 🫰 🫱 🫲 👀 👁️ 🧠 🫀'.split(' ') },
  { id: 'hearts', label: 'Corazones y símbolos', list: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 🔥 ✨ ⭐ 🌟 ⚡ ✅ ❌ ❓ ❗ ⚠️ 🚫 ➕ ➖ ➡️ ⬆️ ⬇️ ♻️ 🔔 🔕 📌 📍'.split(' ') },
  { id: 'party', label: 'Celebración y objetos', list: '🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🏅 🎯 🎮 🎲 🎵 🎶 🎤 🎧 🎸 🥁 📣 📢 💡 🔑 🔒 🔓 🛠️ ⚙️ 💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📷 🎥 📺 📚 📖 📝 ✏️ 📎 📅 📆 ⏰ ⏳ 💰 💳 📈 📉 📊 🚀 🛸'.split(' ') },
  { id: 'nature', label: 'Animales y naturaleza', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦅 🦉 🦄 🐝 🦋 🐢 🐍 🐙 🐬 🐳 🦈 🌵 🌴 🌳 🌱 🍀 🌸 🌹 🌻 🌞 🌝 🌙 ⭐ ☁️ 🌈 ❄️ 🌊'.split(' ') },
  { id: 'food', label: 'Comida y bebida', list: '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥑 🌽 🥕 🍅 🍔 🍟 🍕 🌭 🌮 🌯 🥪 🍝 🍣 🍜 🍩 🍪 🎂 🍰 🍫 🍿 ☕ 🍵 🥤 🍺 🍻 🥂 🍷 🍹'.split(' ') },
  { id: 'travel', label: 'Viajes y deportes', list: '🚗 🚕 🚌 🚲 🛵 ✈️ 🚁 🚢 🏠 🏢 🏖️ ⛰️ 🗽 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 ⛳ 🏊 🚴 🧘 🌍 🗺️ 🧭'.split(' ') },
]

const KEY = 'nora-call-emoji-use'
const read = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number> } catch { return {} } }

/**
 * Los emojis que se ven a mano: los diez de siempre al principio y, con el uso, los que más se mandan van ocupando su lugar.
 * Se recuerdan en este navegador.
 */
export function useFrequentEmojis(size = 10) {
  const [use, setUse] = useState(read)
  const bump = useCallback((e: string) => {
    setUse((cur) => {
      const next = { ...cur, [e]: (cur[e] ?? 0) + 1 }
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* sin almacenamiento */ }
      return next
    })
  }, [])
  const used = Object.entries(use).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([e]) => e)
  const seen = new Set<string>()
  const top = [...used, ...REACTIONS].filter((e) => (seen.has(e) ? false : (seen.add(e), true))).slice(0, size)
  return { top, bump }
}
