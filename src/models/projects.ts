export type ProjectTypeEnum = 'thesis' | 'capstone' | 'dissertation';
export type PaperStandardEnum = 'ieee' | 'apa' | 'mla' | 'chicago';
export type ProjectStatusEnum = 'draft' | 'active' | 'completed' | 'archived';

export interface Project {
  id: string;
  title: string;
  description: string;
  project_type: ProjectTypeEnum;
  paper_standard: PaperStandardEnum;
  status: ProjectStatusEnum;
  keywords: string[];
  created_by: string;
  created_at?: Date;
  updated_at?: Date;
  project_code: string;
  document_reference: string;
  abstract: string;
  program: string;
  course: string;
  section: string;
}

export default Project;
