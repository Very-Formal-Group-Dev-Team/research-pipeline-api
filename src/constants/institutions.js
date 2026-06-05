/**
 * Registered institutions — no CRUD UI yet; seed/validate against this list.
 * Add new entries here when onboarding more schools.
 */
const DEFAULT_INSTITUTION = {
  name: 'Mapúa Malayan Colleges Mindanao',
  code: 'MMCM',
};

const REGISTERED_INSTITUTIONS = [DEFAULT_INSTITUTION];

function getRegisteredInstitutionCodes() {
  return REGISTERED_INSTITUTIONS.map((institution) => institution.code);
}

module.exports = {
  DEFAULT_INSTITUTION,
  REGISTERED_INSTITUTIONS,
  getRegisteredInstitutionCodes,
};
