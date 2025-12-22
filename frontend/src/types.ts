export type IssueType = 
  | 'DUPLICATE_INSERT'      // Battery #2: Overlapped events
  | 'MISSING_PSA_TAPE'      // Battery #1: Missing PSA tape picture
  | 'ORPHAN_ROW'            // Battery #3: Missing SN & PRS
  | 'INDEX_MISMATCH'        // Battery #4: Mismatched PSA indices
  | 'ERROR_EVENT_MISMATCH'  // Battery #5: SQL/MMI error discrepancy
  | 'REPEATED_INSERT';      // PCBA #1: Same content logged multiple times

export type MismatchType = 
  | 'SQL_ONLY'              // Event in SQL but not MMI
  | 'MMI_ONLY'              // Event in MMI but not SQL
  | 'DUPLICATE_IN_SQL'      // Same event logged twice in SQL
  | 'MISSING_CLEAR_TIME';   // Error event has no clear time

export interface Change {
  id: string;
  issue_type: IssueType;
  description: string;
  timestamp: string;
  action: 'DELETE' | 'UPDATE' | 'FLAG';
  sql_row_id: number | null;
  sql_before: Record<string, any> | null;
  sql_after: Record<string, any> | null;
  mmi_evidence: string[];
  mmi_line_numbers: number[];
  status: 'pending' | 'approved' | 'rejected';
  
  // Optional fields for specific issue types
  suggested_value?: string;
  duplicate_of?: number;
  
  // INDEX_MISMATCH specific
  power_index?: number;
  battery_index?: number;
  suggested_battery_index?: number;
  
  // ERROR_EVENT_MISMATCH specific
  mismatch_type?: MismatchType;
  suggested_clear_time?: string;
  
  // REPEATED_INSERT specific
  repeat_count?: number;
  occurrence?: number;
  first_line_number?: number;
}