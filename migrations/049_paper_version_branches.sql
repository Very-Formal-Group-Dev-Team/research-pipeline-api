-- Migration 049: Branching and merging support for paper versions.
-- Adds a branches table and extends paper_versions with branch, parent-pointer,
-- merge-parent, and stored-text columns.
-- version_number is unique per branch_id going forward; existing rows are not renumbered.

-- 1. Create branches table.
--    head_version_id / created_from_version_id reference paper_versions(id) and are
--    nullable so branch rows can exist before any version has been committed.
CREATE TABLE IF NOT EXISTS branches (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()),
  project_id              CHAR(36)     NOT NULL,
  name                    VARCHAR(255) NOT NULL,
  head_version_id         CHAR(36)     NULL,
  created_from_version_id CHAR(36)     NULL,
  created_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branches_project_name (project_id, name),
  CONSTRAINT branches_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT branches_head_fkey
    FOREIGN KEY (head_version_id) REFERENCES paper_versions(id) ON DELETE SET NULL,
  CONSTRAINT branches_created_from_fkey
    FOREIGN KEY (created_from_version_id) REFERENCES paper_versions(id) ON DELETE SET NULL
);

-- 2. Extend paper_versions with branch, parent-pointer, merge-parent, and full text.
ALTER TABLE paper_versions
  ADD COLUMN IF NOT EXISTS branch_id               CHAR(36)  NULL,
  ADD COLUMN IF NOT EXISTS parent_version_id       CHAR(36)  NULL,
  ADD COLUMN IF NOT EXISTS merge_parent_version_id CHAR(36)  NULL,
  ADD COLUMN IF NOT EXISTS content_text            LONGTEXT  NULL;

-- 3. Add FK constraints on the new paper_versions columns.
--    MySQL has no ADD CONSTRAINT IF NOT EXISTS, so we use prepared statements.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'paper_versions'
     AND CONSTRAINT_NAME = 'pv_branch_id_fkey') = 0,
  'ALTER TABLE paper_versions ADD CONSTRAINT pv_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'paper_versions'
     AND CONSTRAINT_NAME = 'pv_parent_fkey') = 0,
  'ALTER TABLE paper_versions ADD CONSTRAINT pv_parent_fkey FOREIGN KEY (parent_version_id) REFERENCES paper_versions(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = DATABASE()
     AND TABLE_NAME = 'paper_versions'
     AND CONSTRAINT_NAME = 'pv_merge_parent_fkey') = 0,
  'ALTER TABLE paper_versions ADD CONSTRAINT pv_merge_parent_fkey FOREIGN KEY (merge_parent_version_id) REFERENCES paper_versions(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- 4. Backfill existing data.
START TRANSACTION;

-- 4a. Create a "main" branch for every project that does not already have one.
INSERT INTO branches (id, project_id, name, created_at)
SELECT UUID(), p.id, 'main', NOW()
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM branches b
  WHERE b.project_id = p.id AND b.name = 'main'
);

-- 4b. Assign all unlinked paper_versions rows to their project's "main" branch.
UPDATE paper_versions pv
JOIN branches b ON b.project_id = pv.project_id AND b.name = 'main'
SET pv.branch_id = b.id
WHERE pv.branch_id IS NULL;

-- 4c. Set parent_version_id by linking each version to the immediately preceding
--     version_number within the same branch (linear history reconstruction).
UPDATE paper_versions pv
JOIN paper_versions prev
  ON prev.branch_id = pv.branch_id
  AND prev.version_number = pv.version_number - 1
SET pv.parent_version_id = prev.id
WHERE pv.parent_version_id IS NULL
  AND pv.version_number > 1;

-- 4d. Point each branch's head_version_id at the version with the highest version_number.
UPDATE branches b
JOIN (
  SELECT pv.branch_id, pv.id AS latest_id
  FROM paper_versions pv
  INNER JOIN (
    SELECT branch_id, MAX(version_number) AS max_v
    FROM paper_versions
    WHERE branch_id IS NOT NULL
    GROUP BY branch_id
  ) mx ON mx.branch_id = pv.branch_id AND pv.version_number = mx.max_v
) latest ON latest.branch_id = b.id
SET b.head_version_id = latest.latest_id
WHERE b.head_version_id IS NULL;

COMMIT;

-- Note: version_number is now unique per branch_id going forward.
-- Existing rows retain their original values and are not renumbered.
