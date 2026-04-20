ALTER TABLE projects
  MODIFY COLUMN paper_standard ENUM('ieee','apa','mla','chicago','imrad','iaaa','custom') NOT NULL DEFAULT 'ieee';
