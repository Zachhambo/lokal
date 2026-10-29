'use strict'

/**
 * Find an existing indexed file matching the metadata AND physical audio
 * edition. Stereo and verified E-AC-3 JOC are independent library copies:
 * identical titles and durations are not enough to deduplicate them.
 *
 * AC-4 is a separate encoded edition without implying verified Atmos. Other
 * unknown/unverified media belongs to the ordinary (non-Atmos) edition.
 */
const AC4_CODEC_SQL = "LOWER(TRIM(COALESCE(codec, ''))) IN ('ac4', 'ac-4', '<ac4>', '<ac-4>')"

function isAc4Codec(codec) {
  return /^(?:ac-?4|<ac-?4>)$/i.test(String(codec || '').trim())
}

function findAudioEditionDuplicate(db, { title, artist, album, duration, atmosVerified, codec } = {}) {
  return db.prepare(`SELECT * FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? AND (album IS NULL OR album = ? OR ? IS NULL OR album IS NULL) AND ABS(duration - ?) < 2 AND file_path NOT LIKE 'ghost://%' AND COALESCE(atmos_verified, 0) = ? AND (${AC4_CODEC_SQL}) = ?`)
    .get(String(title || '').toLowerCase(), String(artist || '').toLowerCase(), album || null, album || null,
      Number(duration) || 0, atmosVerified === 1 ? 1 : 0, isAc4Codec(codec) ? 1 : 0)
}

module.exports = { findAudioEditionDuplicate, isAc4Codec, AC4_CODEC_SQL }
