/**
 * Bootstrap institutions for dev/first deploy. Production catalog is managed via admin UI.
 * Entries here are upserted into the institutions table on search.
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
