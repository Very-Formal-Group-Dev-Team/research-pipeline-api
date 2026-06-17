// arxiv_categories.js
// Minimal arXiv category code -> human-friendly full name mapping with sensible fallbacks.

const CATEGORY_MAP = {
  // Common explicit mappings
  'hep-th': 'High Energy Physics — Theory',
  'hep-ph': 'High Energy Physics — Phenomenology',
  'hep-ex': 'High Energy Physics — Experiment',
  'hep-lat': 'High Energy Physics — Lattice',
  'astro-ph': 'Astrophysics',
  'gr-qc': 'General Relativity and Quantum Cosmology',
  'quant-ph': 'Quantum Physics',
  'physics.optics': 'Optics',
  'cond-mat.stat-mech': 'Condensed Matter — Statistical Mechanics',
  'cond-mat.str-el': 'Condensed Matter — Strongly Correlated Electrons',
  'cond-mat.mes-hall': 'Condensed Matter — Mesoscale & Hall systems',
  'cond-mat.mtrl-sci': 'Condensed Matter — Materials Science',
  'math.CA': 'Mathematics — Classical Analysis and ODEs',
  'math.CO': 'Mathematics — Combinatorics',
  'math.DG': 'Mathematics — Differential Geometry',
  'math.AP': 'Mathematics — Analysis of PDEs',
  'math.MP': 'Mathematical Physics',
  'cs.CG': 'Computer Science — Computational Geometry',
  'cs.AI': 'Computer Science — Artificial Intelligence',
  'cs.LG': 'Computer Science — Machine Learning',
  'cs.HC': 'Computer Science — Human Computation',
  'cs.DL': 'Computer Science — Deep Learning',
  'cs.DC': 'Computer Science — Direct Current',
  'cs.IR': 'Computer Science — ',
  'econ.EM': 'Economics — Econometrics',
};

const DOMAIN_MAP = {
  hep: 'High Energy Physics',
  'cond-mat': 'Condensed Matter',
  'astro-ph': 'Astrophysics',
  'gr-qc': 'General Relativity & Quantum Cosmology',
  'quant-ph': 'Quantum Physics',
  math: 'Mathematics',
  cs: 'Computer Science',
  physics: 'Physics',
  econ: 'Economics',
};

function humanize(token) {
  if (!token) return '';
  return String(token)
    .replace(/[_\.\-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function getCategoryFullName(code) {
  if (!code) return '';
  const key = String(code).trim();
  if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];

  // exact domain match (e.g. "astro-ph")
  if (DOMAIN_MAP[key]) return DOMAIN_MAP[key];

  // dotted form: domain.sub (e.g. cond-mat.stat-mech or math.CO)
  if (key.includes('.')) {
    const [domain, sub] = key.split('.', 2);
    const domainFull = CATEGORY_MAP[domain] || DOMAIN_MAP[domain] || humanize(domain);
    const subFull = CATEGORY_MAP[key] || humanize(sub);
    if (!domainFull) return subFull;
    if (!subFull) return domainFull;
    if (domainFull === subFull) return domainFull;
    return `${domainFull} — ${subFull}`;
  }

  // hyphenated short codes like hep-th
  if (key.includes('-')) {
    const [domain, sub] = key.split('-', 2);
    const domainFull = DOMAIN_MAP[domain] || humanize(domain);
    // try compound mapping first
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];

    const subFull = humanize(sub);
    if (!domainFull) return subFull;
    if (!subFull) return domainFull;
    if (domainFull === subFull) return domainFull;
    return `${domainFull} — ${subFull}`;
  }

  // fallback: humanize the whole code
  return humanize(key);
}

module.exports = { getCategoryFullName, CATEGORY_MAP, DOMAIN_MAP };
