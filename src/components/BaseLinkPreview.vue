<template>
  <a
    v-if='card'
    :href='url'
    target='_blank'
    rel='noopener noreferrer'
    class='link-preview-card'
    @click.stop
  >
    <img v-if='card.image' :src='card.image' :alt='card.title || ""' class='link-preview-img' loading='lazy'/>
    <div class='link-preview-body'>
      <div class='link-preview-domain'>{{ domain }}</div>
      <div v-if='card.title' class='link-preview-title'>{{ card.title }}</div>
      <div v-if='card.description' class='link-preview-desc'>{{ card.description }}</div>
    </div>
  </a>
</template>

<script>
import DOMPurify from 'dompurify'

// microlink's free tier allows 25 requests a day per IP and answers 429 past
// that. Share one cache and one backoff across every preview, and keep the
// backoff across reloads, so a busy feed doesn't keep hitting the limit.
const BACKOFF_KEY = 'astral.linkPreviewBackoff'
const MIN_BACKOFF = 60 * 1000
const MAX_BACKOFF = 6 * 60 * 60 * 1000
const cards = new Map() // url → Promise<card | null>
let queue = Promise.resolve()
let backoff = { until: 0, wait: 0 }
try { backoff = JSON.parse(localStorage.getItem(BACKOFF_KEY)) || backoff } catch { /* storage blocked */ }

// Wait until microlink's reset time when it sends one, else back off exponentially.
function pauseUntilReset(res) {
  const reset = Number(res.headers.get('x-rate-limit-reset')) * 1000
  const wait = Math.min(MAX_BACKOFF, Math.max(MIN_BACKOFF, backoff.wait * 2))
  backoff = { until: reset > Date.now() ? reset : Date.now() + wait, wait }
  try { localStorage.setItem(BACKOFF_KEY, JSON.stringify(backoff)) } catch { /* storage blocked */ }
}

async function fetchCard(url) {
  if (Date.now() < backoff.until) return null
  const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`)
  if (res.status === 429) {
    pauseUntilReset(res)
    cards.delete(url) // try this one again once the backoff ends
    return null
  }
  if (!res.ok) return null
  if (res.headers.get('x-rate-limit-remaining') === '0') pauseUntilReset(res)
  else if (backoff.wait) {
    backoff = { until: 0, wait: 0 }
    try { localStorage.removeItem(BACKOFF_KEY) } catch { /* storage blocked */ }
  }
  const { status, data } = await res.json()
  if (status !== 'success' || !data) return null
  return {
    title: data.title ? DOMPurify.sanitize(data.title) : null,
    description: data.description ? DOMPurify.sanitize(data.description) : null,
    image: data.image?.url || null,
  }
}

export default {
  name: 'BaseLinkPreview',
  props: {
    url: { type: String, required: true }
  },

  data() {
    return { card: null }
  },

  computed: {
    domain() {
      try { return new URL(this.url).hostname.replace(/^www\./, '') } catch { return '' }
    }
  },

  async mounted() {
    if (Date.now() < backoff.until) return
    if (!cards.has(this.url)) {
      // One request at a time, so a 429 stops the rest before they're sent.
      const card = queue.then(() => fetchCard(this.url)).catch(() => null)
      queue = card
      cards.set(this.url, card)
    }
    this.card = await cards.get(this.url)
  }
}
</script>

<style lang='css' scoped>
.link-preview-card {
  display: flex;
  flex-direction: row;
  border: 1px solid var(--q-accent);
  border-radius: .5rem;
  overflow: hidden;
  margin-top: .75rem;
  text-decoration: none;
  color: inherit;
  max-width: 32rem;
  transition: opacity .15s;
}
.link-preview-card:hover { opacity: .85; }
.link-preview-img {
  width: 7rem;
  min-width: 7rem;
  object-fit: cover;
  flex-shrink: 0;
}
.link-preview-body {
  padding: .5rem .65rem;
  display: flex;
  flex-direction: column;
  gap: .2rem;
  overflow: hidden;
  min-width: 0;
}
.link-preview-domain {
  font-size: .7rem;
  opacity: .6;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.link-preview-title {
  font-weight: 600;
  font-size: .85rem;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.link-preview-desc {
  font-size: .78rem;
  opacity: .7;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
