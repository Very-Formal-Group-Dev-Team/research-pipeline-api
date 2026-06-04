-- Research project lifecycle stages (replaces draft / active / archived)

UPDATE projects SET status = 'topic_proposal' WHERE status = 'draft';
UPDATE projects SET status = 'ongoing' WHERE status = 'active';
UPDATE projects SET status = 'completed' WHERE status = 'archived';

ALTER TABLE projects
  MODIFY COLUMN status ENUM(
    'topic_proposal',
    'approved',
    'ongoing',
    'for_pre_defense',
    'for_final_defense',
    'completed',
    'for_publication'
  ) NOT NULL DEFAULT 'topic_proposal';
