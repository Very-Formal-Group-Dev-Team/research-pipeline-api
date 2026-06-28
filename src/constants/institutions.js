/**
 * Bootstrap institutions for first deploy only (empty institutions table).
 * Production catalog is managed via admin UI after the first institution exists.
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
