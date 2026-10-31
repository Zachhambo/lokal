// Only changes affecting the *current* addon's audio output should trigger
// another source load. Verification refreshes the provider list and auth
// metadata but must not restart an already playing song.
export function addonPlaybackOutputKey(provider, preferences) {
  if (typeof provider !== 'string' || !provider.startsWith('a-')) return ''
  const option = preferences?.[provider]
  return `${provider}:${option?.nativeSpatialPreferred ? 'native' : 'stereo'}:${option?.nativeSpatialCodec || ''}`
}
