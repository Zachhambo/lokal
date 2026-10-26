import React, { useEffect, useState } from 'react'
import { trackArtURL, trackFullArtURL } from '../onlineTracks'

// Render ordinary local/remote album art; an unavailable large image retries
// the thumbnail, and a new track retries the large image again.
function SceneArtwork({ track, x, y, width, height }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [track])
  const full = trackFullArtURL(track) || trackArtURL(track)
  const fallback = trackArtURL(track)
  if (!full) return null
  return <image href={failed ? fallback : full} x={x} y={y} width={width} height={height}
    preserveAspectRatio="xMidYMid slice" onError={() => {
      if (!failed && fallback && full !== fallback) setFailed(true)
    }} />
}

// A self-contained, scalable scene instead of a Wallpaper Engine dependency or
// a recorded wallpaper (which would hard-code somebody else's album artwork).
// All scenery is static SVG. Only the vinyl group animates; the album sleeve
// and record label both receive the active track artwork.
export default function FullscreenTurntable({ track, playing }) {
  return (
    <div className="fullscreen-turntable absolute inset-0 overflow-hidden pointer-events-none" data-fullscreen-turntable="">
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full"
        role="img" aria-label="A record player spinning the current album beside its sleeve">
        <defs>
          <linearGradient id="tt-wall" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#bfa57b" /><stop offset=".44" stopColor="#e3cba6" /><stop offset="1" stopColor="#6d5b45" />
          </linearGradient>
          <linearGradient id="tt-sun" x1="0" y1="0" x2=".85" y2="1">
            <stop stopColor="#fffae0" stopOpacity=".75" /><stop offset="1" stopColor="#e9b871" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tt-wood" x1="0" y1="0" x2=".8" y2="1">
            <stop stopColor="#805131"/><stop offset=".37" stopColor="#54301c"/><stop offset=".78" stopColor="#422519"/><stop offset="1" stopColor="#24130e"/>
          </linearGradient>
          <linearGradient id="tt-hardware" x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#45413a"/><stop offset=".46" stopColor="#1d1c1b"/><stop offset="1" stopColor="#080809"/>
          </linearGradient>
          <linearGradient id="tt-metal" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#bcb5a8"/><stop offset=".35" stopColor="#494948"/><stop offset=".62" stopColor="#dad7ce"/><stop offset="1" stopColor="#343537"/>
          </linearGradient>
          <radialGradient id="tt-record">
            <stop stopColor="#1e2020"/><stop offset=".68" stopColor="#101113"/><stop offset=".94" stopColor="#292929"/><stop offset="1" stopColor="#070708"/>
          </radialGradient>
          <radialGradient id="tt-vignette">
            <stop offset=".4" stopColor="#000" stopOpacity="0"/>
            <stop offset="1" stopColor="#000" stopOpacity=".74"/>
          </radialGradient>
          <pattern id="tt-grain" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
            <path d="M0 12H90 M-20 37H80 M7 79H102" stroke="#d5a577" strokeOpacity=".07" strokeWidth="3" />
            <path d="M14 22H67 M-8 63H83" stroke="#120904" strokeOpacity=".15" strokeWidth="2" />
          </pattern>
          <clipPath id="tt-label-mask"><circle cx="0" cy="0" r="72" /></clipPath>
        </defs>
        {/* The vertical blinds throw long, warm afternoon light across the wall. */}
        <rect width="1920" height="1080" fill="url(#tt-wall)"/>
        <path d="M70 0H1170V625H70Z" fill="#2c261c" opacity=".62"/>
        <rect x="100" y="-25" width="1060" height="636" fill="#d9c4a0"/>
        <rect x="130" y="-25" width="990" height="580" fill="#f8e8bf" opacity=".66"/>
        {Array.from({ length: 16 }, (_, i) => (
          <g key={i}>
            <rect x="115" y={i * 36 - 20} width="1020" height="29" fill={i % 2 ? '#e4d2ad' : '#f2e3be'} opacity=".94" />
            <path d={`M115 ${i * 36 + 9}H1135`} stroke="#514533" strokeOpacity=".48" strokeWidth="8"/>
            <path d={`M115 ${i * 36 - 18}H1135`} stroke="#fff4d6" strokeOpacity=".36" strokeWidth="4"/>
          </g>
        ))}
        <path d="M583 -10V594M1121 -10V594" stroke="#7e664b" strokeWidth="20" opacity=".55"/>
        <path d="M0 100L1540 0 1830 845 0 730Z" fill="url(#tt-sun)"/>
        <path d="M1280 0L1920 0 1920 740 1330 520Z" fill="#3d352d" opacity=".5"/>
        {/* Wood grain follows the table's perspective. */}
        <path d="M0 582L1920 555V1080H0Z" fill="url(#tt-wood)"/>
        <path d="M0 582L1920 555V1080H0Z" fill="url(#tt-grain)"/>
        <path d="M0 619L1920 588" stroke="#c08a50" strokeOpacity=".3" strokeWidth="7"/>
        <path d="M-80 865L1920 714M-60 1016L1920 873M160 1080L1920 982" stroke="#190f0b" strokeOpacity=".3" strokeWidth="3" />
        {/* LP sleeve leaning on the window ledge: the art is a normal img URL,
            never an extracted frame from the supplied reference video. */}
        <path d="M194 655L648 639 659 678 201 698Z" fill="#130c09" opacity=".48"/>
        <g transform="translate(176 197) rotate(-4 228 228)">
          <rect x="-7" y="8" width="456" height="458" rx="2" fill="#110e0d" opacity=".5"/>
          <rect x="0" y="0" width="446" height="446" fill="#b9a689"/>
          <rect x="9" y="9" width="428" height="428" fill="#26211d"/>
          <SceneArtwork track={track} x={9} y={9} width={428} height={428}/>
          <path d="M10 10H436V34H10Z" fill="#fff" opacity=".045"/>
          <path d="M9 9V436H24V9Z" fill="#fff" opacity=".09"/>
          <path d="M437 9V437H421V9Z" fill="#070604" opacity=".25"/>
        </g>
        {/* Deck: perspective base, bevel, steel feet and matte top plate. */}
        <path d="M696 653L1643 597 1817 928 817 1021Z" fill="#080809" opacity=".5"/>
        <path d="M699 619L1640 574 1768 898 814 960Z" fill="#151515" stroke="#0b0b0d" strokeWidth="10"/>
        <path d="M699 619L1640 574 1735 851 797 916Z" fill="url(#tt-hardware)" stroke="#858176" strokeOpacity=".45" strokeWidth="4"/>
        <path d="M796 916L1735 851 1768 898 814 960Z" fill="#0c0b0b"/>
        <path d="M837 952L889 949 894 973 844 978ZM1660 904L1708 902 1713 927 1663 930Z" fill="#08080a"/>
        {/* Platter is foreshortened, with physical grooves and center label. */}
        <g transform="translate(1183 755) scale(1 .61)">
          <circle r="287" fill="#090a0b" stroke="#88877f" strokeWidth="10"/>
          <circle r="275" fill="#5d5e5a" stroke="#161717" strokeWidth="17"/>
          <circle r="261" fill="#131314"/>
          <g className="fullscreen-turntable-vinyl" style={{ animationPlayState: playing ? 'running' : 'paused' }}>
            <circle r="255" fill="url(#tt-record)"/>
            {[111,122,135,150,164,177,191,204,215,227,237,249].map(radius => (
              <circle key={radius} r={radius} fill="none" stroke={radius % 2 ? '#777979' : '#090a0b'} strokeOpacity=".25" strokeWidth="1.4"/>
            ))}
            <circle r="88" fill="#c5c1b5"/>
            <circle r="78" fill="#27211e"/>
            <g clipPath="url(#tt-label-mask)">
              <rect x="-72" y="-72" width="144" height="144" fill="#4b4235"/>
              <SceneArtwork track={track} x={-72} y={-72} width={144} height={144}/>
            </g>
            <circle r="72" fill="none" stroke="#ddd2ac" strokeWidth="2"/>
            <circle r="12" fill="#d0c9b2"/>
          </g>
          <circle r="7" fill="url(#tt-metal)" stroke="#262625" strokeWidth="2"/>
          <path d="M-257 -15A258 258 0 0 1 183 -179" fill="none" stroke="#f8f6e5" strokeOpacity=".15" strokeWidth="6"/>
        </g>
        {/* Tonearm stays above the spinning platter. */}
        <g>
          <ellipse cx="1560" cy="659" rx="54" ry="29" fill="#131313"/>
          <ellipse cx="1560" cy="646" rx="37" ry="22" fill="url(#tt-metal)" stroke="#0e0e0f" strokeWidth="7"/>
          <circle cx="1560" cy="641" r="15" fill="#272625"/>
          <path d="M1558 638L1482 691 1352 742 1296 782" stroke="#070808" strokeWidth="18" strokeLinecap="round" fill="none"/>
          <path d="M1558 634L1482 683 1352 734 1296 775" stroke="url(#tt-metal)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <path d="M1296 775L1264 805" stroke="#c5bfae" strokeWidth="17" strokeLinecap="round"/>
          <path d="M1255 797L1238 810 1247 832 1274 815Z" fill="#25282b" stroke="#868881" strokeWidth="2"/>
        </g>
        <ellipse cx="803" cy="790" rx="18" ry="12" fill="#c8ba85"/>
        <ellipse cx="803" cy="786" rx="9" ry="6" fill="#242324"/>
        <circle cx="1658" cy="822" r="15" fill="#1f2021" stroke="#99968d" strokeWidth="5"/>
        {/* Edge shadow and vignette anchor the scene when the app fills an ultrawide screen. */}
        <rect width="1920" height="1080" fill="url(#tt-vignette)" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15"/>
    </div>
  )
}
