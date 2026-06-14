const institutionsService = require('../institutions/institutions.service');

async function listInstitutions() {
  const rows = await institutionsService.listAllInstitutions();
  return { data: rows };
}

async function createInstitution(payload) {
  return institutionsService.createInstitution(payload);
}

async function updateInstitution(institutionId, payload) {
  return institutionsService.updateInstitution(institutionId, payload);
}

async function listPrograms(institutionId) {
  return institutionsService.listProgramsForInstitution(institutionId);
}

async function createProgram(institutionId, payload) {
  return institutionsService.createProgram(institutionId, payload);
}

async function updateProgram(institutionId, programId, payload) {
  return institutionsService.updateProgram(programId, institutionId, payload);
}

module.exports = {
  listInstitutions,
  createInstitution,
  updateInstitution,
  listPrograms,
  createProgram,
  updateProgram,
};
