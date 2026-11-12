import React, { useEffect, useState } from 'react'
import { Monitor, Pause, Pencil, Play, SkipBack, SkipForward, Smartphone, X } from 'lucide-react'
import { useTranslation } from '../i18n'
import { api } from '../api'
import { usePlayerStore } from '../store/player'

export default function LinkedDevicesPanel() {
  const { t } = useTranslation()
  const [devices, setDevices] = useState([])
  const [editingName, setEditingName] = useState(null)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [pairing, setPairing] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [themeSync,setThemeSync]=useState(false)
  const [revoking, setRevoking] = useState(null)
  useEffect(() => {
    let live = true
    const refresh = async () => {
      try { const result=await window.electron.getLinkDevices(); if(live)setDevices(Array.isArray(result)?result:[]) }
      catch { if(live)setError(t('Linked devices could not be loaded.')) }
    }
    refresh()
    api.getSettings().then(settings=>{if(live)setThemeSync(settings?.link_theme_sync==='1')}).catch(()=>{})
    const timer=setInterval(()=>{setNow(Date.now());refresh()},2000)
    return ()=>{live=false;clearInterval(timer)}
  }, [t])
  const pair = async () => {
    setBusy(true);setError('')
    try { const result=await window.electron.createLinkPairing();if(!result?.code)throw Error(t('Desktop pairing is unavailable.'));setPairing(result) }
    catch(error){setError(error.message || t('Desktop pairing is unavailable.'))}
    finally{setBusy(false)}
  }
  const command = async (id,action,value) => {
    setError('')
    try { const result=await window.electron.commandLinkDevice(id,{action,value});if(result?.error || result?.ok===false)throw Error(result.error || t('The phone did not accept the command.')) }
    catch(error){setError(error.message || t('The phone did not respond.'))}
  }
  const playOnPhone = async id => {
    const state=usePlayerStore.getState(),queue=state.shuffle&&state.shuffleQueue.length?state.shuffleQueue:state.queue,index=state.shuffle?state.shuffleIndex:state.queueIndex;
    if(!queue.length)return;
    setBusy(true);setError('');
    try {
      const tracks=queue.map(track=>({id:track.id,title:track.title,artist:track.artist,album:track.album,duration:track.duration,file_hash:track.file_hash,fileType:String(track.file_path||'').split('.').at(-1)||'bin',hasArtwork:!!track.artwork_path}));
      const result=await window.electron.commandLinkDevice(id,{action:'handoff',value:{queue:tracks,index,positionMs:Math.round((state.progress||0)*1000)}});
      if(result?.ok!==true)throw Error(result?.error||t('The phone could not receive playback.'));
      const volume=usePlayerStore.getState().volume;
      for(let step=9;step>=0;step--){usePlayerStore.getState().setVolume(volume*step/10);await new Promise(resolve=>setTimeout(resolve,25))}
      if(usePlayerStore.getState().isPlaying)usePlayerStore.getState().togglePlay();
      usePlayerStore.getState().setVolume(volume);
    }catch(error){setError(error.message||t('The phone could not receive playback.'))}
    finally{setBusy(false)}
  }
  const toggleTheme = async value => {
    try{await api.saveSettings({link_theme_sync:value?'1':'0'});setThemeSync(value)}catch{setError(t('Theme sync could not be saved.'))}
  }
  const revoke = async id => {
    if(revoking!==id){setRevoking(id);return}
    try { await window.electron.revokeLinkDevice(id);setDevices(devices=>devices.filter(d=>d.id!==id));setRevoking(null) }
    catch{setError(t('The device could not be revoked.'))}
  }
  const rename = async (device, name) => {
    setSavingName(true); setError('')
    try {
      const result = await window.electron.renameLinkDevice(device.id, name)
      if (!result?.ok || !result.device) throw Error(t('The device name could not be saved.'))
      setDevices(devices => devices.map(item => item.id === device.id ? {...item, ...result.device} : item))
      setEditingName(null)
    } catch { setError(t('The device name could not be saved.')) }
    finally { setSavingName(false) }
  }
  const remaining = pairing ? Math.max(0,Math.ceil((pairing.expiresAt-now)/1000)) : 0
  return <section className="mt-4 space-y-3 border-t border-white/10 pt-4" aria-label={t('Linked devices')}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-display uppercase tracking-wider text-muted">{t('Linked devices')}</h3><button type="button" disabled={busy} onClick={pair} className="text-xs font-medium text-accent disabled:opacity-50">{t('Pair a phone')}</button></div>
    {pairing && <div className="rounded-xl border border-white/10 p-3">
      <div className="flex items-start gap-3">{pairing.qrDataUrl&&remaining>0&&<img src={pairing.qrDataUrl} alt={t('Desktop pairing QR code')} className="h-28 w-28 rounded-lg bg-white"/>}<div className="min-w-0"><p className="text-xs text-muted">{t('Scan with Lokal on your phone, or enter this code.')}</p><p className="my-2 font-mono text-2xl tracking-widest text-text">{remaining>0?pairing.code:'••••••'}</p><p role="status" className="text-xs text-muted">{remaining>0?`${t('Expires in')} ${remaining}s`:t('Code expired. Pair again for a new code.')}</p></div></div>
    </div>}
    {devices.filter(d=>!d.revoked).map(device=>{const state=device.state||{};return <div key={device.id} className="rounded-xl border border-white/10 p-3">
      <div className="flex items-center gap-2"><Smartphone size={18} className="text-accent"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text" title={device.name}>{device.name}</p><p className="truncate text-xs text-muted">{device.connected?(state.currentTrack?`${state.currentTrack.title} · ${state.currentTrack.artist}`:t('Connected')):t('Offline')}</p></div><button type="button" onClick={()=>{setEditingName(device.id);setNameDraft(device.customName || '');setError('')}} aria-label={`${t('Rename device')}: ${device.name}`} className="shrink-0 p-1 text-muted hover:text-text"><Pencil size={14}/></button><button type="button" onClick={()=>revoke(device.id)} aria-label={t('Revoke device')} className="p-1 text-xs text-muted hover:text-red-400">{revoking===device.id?t('Confirm revoke'):<X size={16}/>}</button></div>
      {editingName===device.id&&<form className="mt-3 space-y-2" onSubmit={event=>{event.preventDefault();rename(device,nameDraft)}}>
        <label className="block text-xs text-muted" htmlFor={`device-name-${device.id}`}>{t('Device name')}</label>
        <input id={`device-name-${device.id}`} autoFocus maxLength={100} value={nameDraft} disabled={savingName} onChange={event=>setNameDraft(event.target.value)} className="w-full min-w-0 rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-sm text-text" placeholder={device.reportedName || device.name}/>
        <div className="flex flex-wrap gap-3 text-xs"><button type="submit" disabled={savingName} className="text-accent disabled:opacity-50">{t('Save')}</button><button type="button" disabled={savingName} onClick={()=>setEditingName(null)} className="text-muted">{t('Cancel')}</button>{device.customName&&<button type="button" disabled={savingName} onClick={()=>rename(device,'')} className="text-muted">{t('Use device name')}</button>}</div>
      </form>}
      {device.connected&&<><div className="mt-3 flex items-center justify-between gap-2"><div className="flex items-center gap-3">{[['prev',SkipBack],['togglePlay',state.isPlaying?Pause:Play],['next',SkipForward]].map(([action,Icon])=><button type="button" key={action} onClick={()=>command(device.id,action)} aria-label={t(action==='prev'?'Previous':action==='next'?'Next':state.isPlaying?'Pause':'Play')} className="rounded-full p-2 text-text hover:bg-white/10"><Icon size={18}/></button>)}</div><button type="button" disabled={busy} onClick={()=>command(device.id,'handoffToDesktop')} className="flex items-center gap-1.5 text-xs text-accent"><Monitor size={14}/>{t('Play here')}</button><button type="button" disabled={busy} onClick={()=>playOnPhone(device.id)} className="text-xs text-accent disabled:opacity-50">{t('Play on phone')}</button></div><input aria-label={t('Phone volume')} type="range" min="0" max="1" step="0.01" defaultValue={state.volume??0.8} onPointerUp={event=>command(device.id,'volume',Number(event.currentTarget.value))} onKeyUp={event=>command(device.id,'volume',Number(event.currentTarget.value))} className="mt-2 w-full accent-[var(--color-accent)]"/></>}
    </div>})}
    {!devices.some(d=>!d.revoked)&&<p className="text-xs text-muted">{t('Pair your phone to control playback and merge your library over Wi-Fi.')}</p>}
    <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={themeSync} onChange={event=>toggleTheme(event.target.checked)}/>{t('Match paired phone theme')}</label>
    {busy&&<p role="status" className="text-xs text-muted">{t('Preparing playback…')}</p>}
    {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}
  </section>
}
