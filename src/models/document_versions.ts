export type DocumentVersionStatusEnum = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface DocumentVersion {
  id: string; // uuid
  document_id: string; // uuid
  version_number: number; // integer
  file_url: string; // text
  file_size: number; // bigint
  uploaded_by: string; // uuid
  change_summary: string; // text
  status: DocumentVersionStatusEnum; // public.doc_version_status_enum
  approved_by: string | null; // uuid (nullable)
  approved_at: Date | null; // timestamp with time zone (nullable)
  created_at: Date; // timestamp with time zone
  updated_at?: Date;
}

export default DocumentVersion;