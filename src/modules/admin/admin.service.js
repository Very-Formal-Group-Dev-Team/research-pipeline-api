const institutionsService = require('../institutions/institutions.service');
const { logAuditEntry } = require('../audit/audit.service');
const adminUsersService = require('./admin.users.service');

async function listInstitutions() {
  const rows = await institutionsService.listAllInstitutions();
  return { data: rows };
}

async function createInstitution(actorUserId, payload) {
  const result = await institutionsService.createInstitution(payload);
  if (result.data) {
    await logAuditEntry({
      action: 'institution.created',
      actorUserId,
      targetType: 'institution',
      targetId: result.data.id,
      metadata: {
        name: result.data.name,
        code: result.data.code,
      },
    });
  }
  return result;
}

async function updateInstitution(actorUserId, institutionId, payload) {
  const before = await institutionsService.getInstitutionById(institutionId);
  const result = await institutionsService.updateInstitution(institutionId, payload);
  if (result.data && before) {
    await logAuditEntry({
      action: 'institution.updated',
      actorUserId,
      targetType: 'institution',
      targetId: institutionId,
      institutionId,
      metadata: {
        name: result.data.name,
        code: result.data.code,
        isActive: result.data.is_active,
        previous: {
          name: before.name,
          code: before.code,
          isActive: before.is_active,
        },
      },
    });
  }
  return result;
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
  listUsers: adminUsersService.listUsers,
  getUserById: adminUsersService.getUserById,
  updateUser: adminUsersService.updateUser,
};
