-- Add rejected research project stage

ALTER TABLE projects
  MODIFY COLUMN status ENUM(
    'topic_proposal',
    'approved',
    'ongoing',
    'for_pre_defense',
    'for_final_defense',
    'completed',
    'for_publication',
    'rejected'
  ) NOT NULL DEFAULT 'topic_proposal';
