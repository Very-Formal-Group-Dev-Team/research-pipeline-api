export type ProposalDocumentStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export interface ProjectDocument {
  id: string;
  proposal_id: string;
  file_url: string;
  file_name: string;
  file_size: number;
  uploaded_by: string;
  status: ProposalDocumentStatus;
  change_summary: string;
  uploaded_at?: Date;
}

export default ProjectDocument;
