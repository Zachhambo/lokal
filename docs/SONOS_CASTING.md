# Sonos and UPnP output

The existing Cast picker includes SSDP-discovered MediaRenderer and Sonos
ZonePlayer devices. Selecting a Sonos room resolves the current group
coordinator without regrouping speakers. Volume and mute use Sonos group
RenderingControl when available, ordinary Master-channel RenderingControl
otherwise. Receiver-side clock, pause and volume changes are polled.

Queue preparation and polling run in Electron's main process. Sonos owns its
native queue; generic receivers receive SetNextAVTransportURI where supported.
The main process retains the existing prevent-app-suspension power blocker and
serves audio/artwork through the token-scoped media server. Minimizing the app
does not suspend this worker. Quitting or killing Lokal still stops hosted media;
this is not an independently hosted music service.

Only the current track and a bounded upcoming window are prepared. Sonos queue
edits preserve current playback and replace the changed future tail. Completed
history is pruned and unused prepared resources are released. Shuffle/repeat-all
remain owned by Lokal; repeat-one can run on Sonos. Generic devices without
SetNext support advance through completion events in the existing player.

DIDL-Lite includes title, artist, album, cover URL and actual MIME. Sonos media
uses the existing cached conversion path with a conservative 16-bit/48-kHz
ceiling; online sources are prepared as compatible audio. This conversion is
not described as bit-perfect. Other renderers' codec support remains device
dependent. Headers/cookies are not sent as receiver metadata.

Failed Stop preserves ownership rather than authorizing simultaneous local
playback. Another controller taking over ends Lokal's session without issuing
Stop against the other controller's music.

## Qualification

Protocol tests exercise encoding, SOAP faults, descriptions, queue reconciliation,
track advancement, volume/mute, unsupported transport and stop failure. These
are automated protocol checks, not evidence of a physical speaker test.
Qualify S1/S2 and current Sonos groups, generic receivers, firewall/network
permissions, local and authenticated online sources, covers, queue edits,
shuffle/repeat, minimized playback, shutdown/reconnect and external controls on
Windows/macOS/Linux before claiming device acceptance.
