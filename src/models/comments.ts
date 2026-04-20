export interface Comment {
  id: string;
  document_id: string;
  version_id: string;
  parent_id: string | null;
  user_id: string;
  content: string;
  created_at?: Date;
  updated_at?: Date;
}

export default Comment;