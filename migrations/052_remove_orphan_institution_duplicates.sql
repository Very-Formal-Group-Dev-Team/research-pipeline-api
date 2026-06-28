-- Migration 052: Remove orphan institution rows created when bootstrap re-seeded MMCM
-- after an admin changed the canonical institution's code away from MMCM.

DELETE i
FROM institutions i
LEFT JOIN user_roles ur ON ur.institution_id = i.id
LEFT JOIN programs p ON p.institution_id = i.id
LEFT JOIN projects proj ON proj.institution_id = i.id
LEFT JOIN courses c ON c.institution_id = i.id
LEFT JOIN events e ON e.institution_id = i.id
WHERE ur.user_id IS NULL
  AND p.id IS NULL
  AND proj.id IS NULL
  AND c.id IS NULL
  AND e.id IS NULL;
