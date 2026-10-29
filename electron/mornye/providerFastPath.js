'use strict'

// Play and Save use the same authorized availability-first acquisition.
// A negative first result may be retried once after enrichment, regardless
// of where the selected catalogue row came from. There are no Tidal or
// other provider-specific exclusions, and a positive ticket never retries.
function shouldRetryEnrichment({ available, hasEnrichment } = {}) {
  return available?.available !== true && hasEnrichment === true
}

module.exports = { shouldRetryEnrichment }
