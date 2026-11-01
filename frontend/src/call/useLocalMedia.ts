import { useCallback, useEffect, useRef, useState } from 'react'

export interface Devices { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }

const KEY = 'nora-call-devices'
const load = (): { mic?: string; cam?: string; speaker?: string } => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}
const save = (v: object) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* sin almacenamiento */ } }

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }

export const mediaSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== 'undefined'

/**
 * Micrófono y cámara de esta persona. El micrófono se silencia con `enabled` (instantáneo, sin renegociar nada) y la cámara se apaga
 * de verdad (se suelta el dispositivo y se apaga su luz); al encenderla se pide de nuevo y las conexiones cambian de pista sin cortarse.
 */
export function useLocalMedia() {
  const saved = useRef(load())
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null)
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null)
  const [mic, setMicState] = useState(false)
  const [cam, setCamState] = useState(false)
  const [micError, setMicError] = useState('')
  const [camError, setCamError] = useState('')
  const [devices, setDevices] = useState<Devices>({ mics: [], cams: [], speakers: [] })
  const [micId, setMicId] = useState(saved.current.mic ?? '')
  const [camId, setCamId] = useState(saved.current.cam ?? '')
  const [speakerId, setSpeakerId] = useState(saved.current.speaker ?? '')
  const audioRef = useRef<MediaStreamTrack | null>(null)
  const videoRef = useRef<MediaStreamTrack | null>(null)

  const refreshDevices = useCallback(async () => {
    try {
      const l = await navigator.mediaDevices.enumerateDevices()
      setDevices({ mics: l.filter((d) => d.kind === 'audioinput'), cams: l.filter((d) => d.kind === 'videoinput'), speakers: l.filter((d) => d.kind === 'audiooutput') })
    } catch { /* sin permisos todavía */ }
  }, [])

  useEffect(() => {
    if (!mediaSupported()) return
    void refreshDevices()
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  const stopTrack = (t: MediaStreamTrack | null) => { try { t?.stop() } catch { /* ya parada */ } }

  const startMic = useCallback(async (id = micId) => {
    if (!mediaSupported()) { setMicError('Este navegador no permite usar el micrófono'); return false }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...AUDIO, deviceId: { exact: id } } : AUDIO })
      const t = s.getAudioTracks()[0]!
      stopTrack(audioRef.current)
      audioRef.current = t
      setAudioTrack(t)
      setMicState(true)
      setMicError('')
      void refreshDevices()
      return true
    } catch (e) {
      setMicError((e as Error).name === 'NotAllowedError' ? 'Permite el micrófono en el navegador' : 'No se encontró un micrófono')
      setMicState(false)
      return false
    }
  }, [micId, refreshDevices])

  const startCam = useCallback(async (id = camId) => {
    if (!mediaSupported()) { setCamError('Este navegador no permite usar la cámara'); return false }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: id ? { ...VIDEO, deviceId: { exact: id } } : VIDEO })
      const t = s.getVideoTracks()[0]!
      stopTrack(videoRef.current)
      videoRef.current = t
      setVideoTrack(t)
      setCamState(true)
      setCamError('')
      void refreshDevices()
      return true
    } catch (e) {
      setCamError((e as Error).name === 'NotAllowedError' ? 'Permite la cámara en el navegador' : 'No se encontró una cámara')
      setCamState(false)
      return false
    }
  }, [camId, refreshDevices])

  const setMic = useCallback(async (on: boolean) => {
    if (on && !audioRef.current) return startMic()
    if (audioRef.current) audioRef.current.enabled = on
    setMicState(on)
    return true
  }, [startMic])

  const setCam = useCallback(async (on: boolean) => {
    if (on) return startCam()
    stopTrack(videoRef.current)
    videoRef.current = null
    setVideoTrack(null)
    setCamState(false)
    return true
  }, [startCam])

  const pickMic = useCallback(async (id: string) => {
    setMicId(id)
    save({ ...load(), mic: id })
    if (audioRef.current) await startMic(id)
  }, [startMic])

  const pickCam = useCallback(async (id: string) => {
    setCamId(id)
    save({ ...load(), cam: id })
    if (videoRef.current) await startCam(id)
  }, [startCam])

  const pickSpeaker = useCallback((id: string) => {
    setSpeakerId(id)
    save({ ...load(), speaker: id })
  }, [])

  const stopAll = useCallback(() => {
    stopTrack(audioRef.current); stopTrack(videoRef.current)
    audioRef.current = null; videoRef.current = null
    setAudioTrack(null); setVideoTrack(null); setMicState(false); setCamState(false)
  }, [])

  useEffect(() => () => { stopTrack(audioRef.current); stopTrack(videoRef.current) }, [])

  return { audioTrack, videoTrack, mic, cam, micError, camError, devices, micId, camId, speakerId, setMic, setCam, pickMic, pickCam, pickSpeaker, stopAll }
}

export type LocalMedia = ReturnType<typeof useLocalMedia>
