-- Migration 016: Populate institution_id for existing projects from their creator's user_roles

UPDATE projects p
INNER JOIN users u ON p.created_by = u.id
INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.role IN ('student', 'adviser', 'coordinator', 'admin')
SET p.institution_id = ur.institution_id
WHERE p.institution_id IS NULL
  AND ur.institution_id IS NOT NULL;

-- For any remaining projects without an institution (edge case), they will stay NULL
-- New projects will have institution_id set at creation time
