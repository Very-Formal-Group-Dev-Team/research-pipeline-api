CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  avatar_url VARCHAR(1024),
  password_hash VARCHAR(255),
  auth_provider ENUM('email', 'google') NOT NULL DEFAULT 'email',
  status SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  role ENUM('student', 'adviser', 'panelist', 'admin') NOT NULL,
  institution_id CHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  title TEXT NOT NULL,
  description TEXT,
  project_type ENUM('thesis', 'capstone', 'dissertation') NOT NULL DEFAULT 'thesis',
  paper_standard ENUM('ieee', 'apa', 'mla', 'chicago') NOT NULL DEFAULT 'ieee',
  status ENUM('draft', 'active', 'completed', 'archived') NOT NULL DEFAULT 'draft',
  keywords JSON DEFAULT (JSON_ARRAY()),
  created_by CHAR(36) NOT NULL,
  project_code CHAR(36) DEFAULT (UUID()),
  document_reference TEXT,
  abstract TEXT,
  program VARCHAR(255),
  course VARCHAR(255),
  section VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('leader', 'member', 'adviser') NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME,
  PRIMARY KEY (id),
  CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_proposals (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36),
  title TEXT NOT NULL,
  abstract TEXT,
  description TEXT,
  keywords JSON DEFAULT (JSON_ARRAY()),
  created_by CHAR(36) NOT NULL,
  adviser_id CHAR(36),
  status ENUM('draft', 'submitted', 'approved', 'rejected', 'revision_requested') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT project_proposals_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT project_proposals_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT project_proposals_adviser_id_fkey FOREIGN KEY (adviser_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_documents (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  proposal_id CHAR(36) NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_size BIGINT,
  uploaded_by CHAR(36) NOT NULL,
  status ENUM('draft', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  change_summary TEXT,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT project_documents_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES project_proposals(id),
  CONSTRAINT project_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rubrics (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  name TEXT NOT NULL,
  defense_type ENUM('proposal', 'midterm', 'final') NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT rubrics_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  rubric_id CHAR(36) NOT NULL,
  criterion_name TEXT NOT NULL,
  description TEXT,
  weight DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_score INT NOT NULL DEFAULT 5,
  `order` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT rubric_criteria_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES rubrics(id)
);

CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  section VARCHAR(100) NOT NULL,
  title TEXT,
  current_version_id CHAR(36),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  document_id CHAR(36) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  uploaded_by CHAR(36) NOT NULL,
  change_summary TEXT,
  status ENUM('draft', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36),
  approved_at DATETIME,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT document_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT document_versions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id)
);

ALTER TABLE documents
  ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);

CREATE TABLE IF NOT EXISTS defenses (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  project_id CHAR(36) NOT NULL,
  defense_type ENUM('proposal', 'midterm', 'final') NOT NULL,
  scheduled_at DATETIME NOT NULL,
  location TEXT,
  rubric_id CHAR(36),
  status ENUM('scheduled', 'completed', 'cancelled', 'rescheduled') NOT NULL DEFAULT 'scheduled',
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT defenses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT defenses_rubric_id_fkey FOREIGN KEY (rubric_id) REFERENCES rubrics(id),
  CONSTRAINT defenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS defense_results (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  defense_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  overall_score DECIMAL(10,2),
  verdict ENUM('pass', 'fail', 'conditional_pass'),
  recommendations TEXT,
  finalized_at DATETIME,
  PRIMARY KEY (id),
  CONSTRAINT defense_results_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id),
  CONSTRAINT defense_results_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  defense_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  panelist_id CHAR(36) NOT NULL,
  criterion_id CHAR(36) NOT NULL,
  score DECIMAL(10,2) NOT NULL,
  comments TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT evaluations_defense_id_fkey FOREIGN KEY (defense_id) REFERENCES defenses(id),
  CONSTRAINT evaluations_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT evaluations_panelist_id_fkey FOREIGN KEY (panelist_id) REFERENCES users(id),
  CONSTRAINT evaluations_criterion_id_fkey FOREIGN KEY (criterion_id) REFERENCES rubric_criteria(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  document_id CHAR(36) NOT NULL,
  version_id CHAR(36),
  parent_id CHAR(36),
  user_id CHAR(36) NOT NULL,
  content TEXT NOT NULL,
  section_ref TEXT,
  is_resolved TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT comments_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT comments_version_id_fkey FOREIGN KEY (version_id) REFERENCES document_versions(id),
  CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES comments(id),
  CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
);
