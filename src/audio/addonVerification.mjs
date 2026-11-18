// Verification opens immediately; only failures need an in-app recovery dialog.
export async function openAddonVerification(pending, {
  getPending, verify, complete, changed, setBusy, setMessage,
}) {
  if (!pending || getPending() !== pending || pending.verifying) return
  pending.verificationStarted = true
  pending.verifying = true
  setBusy(true)
  setMessage('')
  try {
    const result = await verify(pending.key)
    if (getPending() !== pending) return
    if (result?.authenticated) {
      changed()
      await complete(pending.key)
    } else if (!result?.opened) {
      setMessage(result?.error || "Verification couldn't be started. Open Settings → Addons to verify this provider.")
    }
  } catch (error) {
    if (getPending() === pending) {
      setMessage(error?.message || "Verification couldn't be started. Open Settings → Addons to verify this provider.")
    }
  } finally {
    pending.verifying = false
    if (!getPending() || getPending() === pending) setBusy(false)
  }
}
