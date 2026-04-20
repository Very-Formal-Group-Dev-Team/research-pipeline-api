export interface Document {
  id: string;
  project_id: string;
  section: string;
  title: string;
  created_at?: Date;
  updated_at?: Date;
  current_version_id: string;
}

export default Document;