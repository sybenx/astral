// Relays commonly reject (or silently truncate) filters with thousands of
// authors, and a follows list can be that long. Split any `authors` list over
// MAX_AUTHORS into several filters of the same shape.

export const MAX_AUTHORS = 500

export function splitAuthors(filters) {
  const list = Array.isArray(filters) ? filters : [filters]
  const out = []
  for (const f of list) {
    if (!f.authors || f.authors.length <= MAX_AUTHORS) {
      out.push(f)
      continue
    }
    for (let i = 0; i < f.authors.length; i += MAX_AUTHORS) {
      out.push({ ...f, authors: f.authors.slice(i, i + MAX_AUTHORS) })
    }
  }
  return Array.isArray(filters) || out.length > 1 ? out : out[0]
}
