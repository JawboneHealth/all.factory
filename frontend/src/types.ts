export interface Change {
  id: string;
  issue_type: string;
  description: string;
  timestamp: string;
  action: 'DELETE' | 'UPDATE' | 'FLAG';
  sql_row_id: number;
  sql_before: Record<string, any>;
  sql_after: Record<string, any> | null;
  mmi_evidence: string[];
  mmi_line_numbers: number[];
  status: 'pending' | 'approved' | 'rejected';
  suggested_value?: string;
  duplicate_of?: number;
}