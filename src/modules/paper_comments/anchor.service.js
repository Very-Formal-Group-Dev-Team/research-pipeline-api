const Diff = require('diff');

const CONTEXT_LEN = 40;

function normalizeText(text) {
  return (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Normalize text for anchor matching (NBSP, soft hyphens, zero-width chars). */
function normalizeAnchorText(text) {
  return normalizeText(text)
    .replace(/\u00A0/g, ' ')
    .replace(/\u00AD/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toFlexibleWhitespacePattern(text) {
  const normalized = normalizeAnchorText(text).trim();
  if (!normalized) return null;
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.map(escapeRegex).join('\\s+');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function findAllIndices(haystack, needle) {
  const indices = [];
  if (!needle) return indices;
  let pos = 0;
  while (pos < haystack.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    indices.push(idx);
    pos = idx + 1;
  }
  return indices;
}

function scoreMatch(text, start, end, anchor) {
  const prefix = text.slice(Math.max(0, start - CONTEXT_LEN), start);
  const suffix = text.slice(end, Math.min(text.length, end + CONTEXT_LEN));
  let score = 0;
  const normPrefix = normalizeAnchorText(anchor.prefix || '');
  const normSuffix = normalizeAnchorText(anchor.suffix || '');
  const normCtxPrefix = normalizeAnchorText(prefix);
  const normCtxSuffix = normalizeAnchorText(suffix);
  if (normPrefix && normCtxPrefix.endsWith(normPrefix)) score += 2;
  if (normSuffix && normCtxSuffix.startsWith(normSuffix)) score += 2;
  if (typeof anchor.start === 'number') {
    const distance = Math.abs(start - anchor.start);
    score += Math.max(0, 3 - distance / 100);
  }
  return score;
}

function findFlexibleWhitespaceMatch(plainText, anchor) {
  const exact = anchor?.exact || '';
  const pattern = toFlexibleWhitespacePattern(exact);
  if (!pattern) return null;

  const source = normalizeAnchorText(plainText);
  let re;
  try {
    re = new RegExp(pattern, 'g');
  } catch {
    return null;
  }

  const matches = [...source.matchAll(re)];
  if (!matches.length) return null;

  let chosen = matches[0];
  if (matches.length > 1) {
    let bestScore = -1;
    for (const match of matches) {
      const start = match.index;
      const end = start + match[0].length;
      const score = scoreMatch(source, start, end, anchor);
      if (score > bestScore) {
        bestScore = score;
        chosen = match;
      }
    }
  }

  const start = chosen.index;
  const end = start + chosen[0].length;
  return {
    mapped_start: start,
    mapped_end: end,
    anchor_status: 'modified',
    matched_exact: source.slice(start, end),
  };
}

function buildStoredAnchor(plainText, anchor, start, end) {
  const text = normalizeAnchorText(plainText);
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  return {
    type: 'TextQuoteSelector',
    exact: text.slice(safeStart, safeEnd),
    prefix: text.slice(Math.max(0, safeStart - CONTEXT_LEN), safeStart),
    suffix: text.slice(safeEnd, Math.min(text.length, safeEnd + CONTEXT_LEN)),
    start: safeStart,
    end: safeEnd,
  };
}

function toBoundaryAwarePattern(text) {
  const normalized = normalizeAnchorText(text).trim();
  if (!normalized) return null;
  const parts = normalized.split(/(?<=[.!?])(?=[A-Za-z])|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.map(escapeRegex).join('\\s*');
}

function findBoundaryAwareMatch(plainText, anchor) {
  const exact = anchor?.exact || '';
  const pattern = toBoundaryAwarePattern(exact);
  if (!pattern) return null;

  const source = normalizeAnchorText(plainText);
  let re;
  try {
    re = new RegExp(pattern, 'g');
  } catch {
    return null;
  }

  const matches = [...source.matchAll(re)];
  if (!matches.length) return null;

  let chosen = matches[0];
  if (matches.length > 1) {
    let bestScore = -1;
    for (const match of matches) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const nextScore = scoreMatch(source, start, end, anchor);
      if (nextScore > bestScore) {
        bestScore = nextScore;
        chosen = match;
      }
    }
  }

  const start = chosen.index ?? 0;
  const end = start + chosen[0].length;
  return {
    mapped_start: start,
    mapped_end: end,
    anchor_status: 'modified',
    matched_exact: source.slice(start, end),
  };
}

function findByPrefixSuffixRegion(plainText, anchor) {
  const text = normalizeAnchorText(plainText);
  const exact = normalizeAnchorText(anchor?.exact || '');
  const prefix = normalizeAnchorText(anchor?.prefix || '');
  const suffix = normalizeAnchorText(anchor?.suffix || '');
  if (!exact || !prefix || !suffix) return null;

  const prefixTail = prefix.slice(-Math.min(prefix.length, CONTEXT_LEN));
  const suffixHead = suffix.slice(0, Math.min(suffix.length, CONTEXT_LEN));
  if (!prefixTail || !suffixHead) return null;

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const prefixIdx = text.indexOf(prefixTail, searchFrom);
    if (prefixIdx === -1) break;

    const regionStart = prefixIdx + prefixTail.length;
    const suffixIdx = text.indexOf(suffixHead, regionStart);
    if (suffixIdx === -1) {
      searchFrom = prefixIdx + 1;
      continue;
    }

    const region = text.slice(regionStart, suffixIdx);
    const exactIdx = region.indexOf(exact);
    if (exactIdx !== -1) {
      const start = regionStart + exactIdx;
      return {
        mapped_start: start,
        mapped_end: start + exact.length,
        anchor_status: 'modified',
      };
    }

    const pattern = toFlexibleWhitespacePattern(exact);
    if (pattern) {
      const re = new RegExp(pattern);
      const match = region.match(re);
      if (match && match.index != null) {
        const start = regionStart + match.index;
        return {
          mapped_start: start,
          mapped_end: start + match[0].length,
          anchor_status: 'modified',
        };
      }
    }

    const boundary = findBoundaryAwareMatch(region, anchor);
    if (boundary) {
      return {
        mapped_start: regionStart + boundary.mapped_start,
        mapped_end: regionStart + boundary.mapped_end,
        anchor_status: 'modified',
      };
    }

    searchFrom = prefixIdx + 1;
  }

  return null;
}

function remapAnchor(plainText, anchor) {
  const text = normalizeAnchorText(plainText);
  const exact = normalizeAnchorText(anchor?.exact || '');
  if (!exact) {
    return { mapped_start: null, mapped_end: null, anchor_status: 'orphaned' };
  }

  const indices = findAllIndices(text, exact);
  if (indices.length === 1) {
    const start = indices[0];
    const end = start + exact.length;
    const status = typeof anchor.start === 'number' && start !== anchor.start ? 'modified' : 'active';
    return { mapped_start: start, mapped_end: end, anchor_status: status };
  }

  if (indices.length > 1) {
    let best = null;
    let bestScore = -1;
    for (const start of indices) {
      const end = start + exact.length;
      const score = scoreMatch(text, start, end, anchor);
      if (score > bestScore) {
        bestScore = score;
        best = { mapped_start: start, mapped_end: end, anchor_status: score >= 2 ? 'active' : 'modified' };
      }
    }
    if (best) return best;
  }

  const normPrefix = normalizeAnchorText(anchor.prefix || '');
  const normSuffix = normalizeAnchorText(anchor.suffix || '');
  const composite = `${normPrefix}${exact}${normSuffix}`;
  if (composite.length > exact.length) {
    const compositeIdx = text.indexOf(composite);
    if (compositeIdx !== -1) {
      const start = compositeIdx + normPrefix.length;
      return { mapped_start: start, mapped_end: start + exact.length, anchor_status: 'modified' };
    }
  }

  if (typeof anchor.start === 'number') {
    const windowStart = Math.max(0, anchor.start - 200);
    const windowEnd = Math.min(text.length, (anchor.end || anchor.start + exact.length) + 200);
    const window = text.slice(windowStart, windowEnd);
    let bestOffset = -1;
    let bestDistance = Infinity;
    const windowIndices = findAllIndices(window, exact);
    for (const offset of windowIndices) {
      const absStart = windowStart + offset;
      const distance = Math.abs(absStart - anchor.start);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = offset;
      }
    }
    if (bestOffset !== -1) {
      const start = windowStart + bestOffset;
      const candidate = text.slice(start, start + exact.length);
      if (levenshtein(candidate, exact) <= Math.max(2, Math.floor(exact.length * 0.15))) {
        return { mapped_start: start, mapped_end: start + exact.length, anchor_status: 'modified' };
      }
    }
  }

  const flexible = findFlexibleWhitespaceMatch(plainText, anchor);
  if (flexible) {
    return flexible;
  }

  const boundary = findBoundaryAwareMatch(plainText, anchor);
  if (boundary) {
    return boundary;
  }

  const regionMatch = findByPrefixSuffixRegion(plainText, anchor);
  if (regionMatch) {
    return regionMatch;
  }

  return { mapped_start: null, mapped_end: null, anchor_status: 'orphaned' };
}

/**
 * Resolve an anchor against server plain text, normalizing when docx-preview text differs.
 */
function resolveAnchorInPlainText(plainText, anchor) {
  const remapped = remapAnchor(plainText, anchor);
  if (remapped.anchor_status === 'orphaned') {
    return { remapped, anchor };
  }

  const start = remapped.mapped_start;
  const end = remapped.mapped_end;
  if (start == null || end == null) {
    return { remapped, anchor };
  }

  const storedAnchor = buildStoredAnchor(plainText, anchor, start, end);
  return { remapped, anchor: storedAnchor };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function computeTouchedByDiff(anchorText, previousText, currentText) {
  if (!anchorText || !previousText || !currentText) return false;
  const changes = Diff.diffWords(previousText, currentText);
  let pointer = 0;
  for (const part of changes) {
    const val = part.value || '';
    if (!val) continue;
    const start = pointer;
    const end = pointer + val.length;
    if (part.added || part.removed) {
      const anchorStart = currentText.indexOf(anchorText);
      if (anchorStart !== -1) {
        const anchorEnd = anchorStart + anchorText.length;
        const rangeStart = part.added ? start : start;
        const rangeEnd = end;
        if (rangesOverlap(anchorStart, anchorEnd, rangeStart, rangeEnd)) {
          return true;
        }
      }
    }
    if (!part.added) pointer += val.length;
  }
  return false;
}

function buildTextQuoteSelector(plainText, start, end) {
  return buildStoredAnchor(plainText, {}, start, end);
}

module.exports = {
  remapAnchor,
  resolveAnchorInPlainText,
  computeTouchedByDiff,
  buildTextQuoteSelector,
  normalizeText,
  normalizeAnchorText,
};
