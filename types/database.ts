export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_applications: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_applications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          alert_type: string
          channels: string[]
          created_at: string | null
          entity_type: string
          id: string
          is_active: boolean
          name: string
          notify_assignee: boolean
          notify_requester: boolean
          notify_roles: string[]
          org_id: string | null
          threshold_minutes: number | null
        }
        Insert: {
          alert_type: string
          channels?: string[]
          created_at?: string | null
          entity_type?: string
          id?: string
          is_active?: boolean
          name: string
          notify_assignee?: boolean
          notify_requester?: boolean
          notify_roles?: string[]
          org_id?: string | null
          threshold_minutes?: number | null
        }
        Update: {
          alert_type?: string
          channels?: string[]
          created_at?: string | null
          entity_type?: string
          id?: string
          is_active?: boolean
          name?: string
          notify_assignee?: boolean
          notify_requester?: boolean
          notify_roles?: string[]
          org_id?: string | null
          threshold_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      approval_decisions: {
        Row: {
          approval_id: string
          comment: string | null
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision_type"]
          id: string
          step_order: number
        }
        Insert: {
          approval_id: string
          comment?: string | null
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["approval_decision_type"]
          id?: string
          step_order: number
        }
        Update: {
          approval_id?: string
          comment?: string | null
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["approval_decision_type"]
          id?: string
          step_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_decisions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_workflow_steps: {
        Row: {
          approver_type: Database["public"]["Enums"]["approver_type"]
          approver_user_id: string | null
          id: string
          step_order: number
          workflow_id: string
        }
        Insert: {
          approver_type: Database["public"]["Enums"]["approver_type"]
          approver_user_id?: string | null
          id?: string
          step_order: number
          workflow_id: string
        }
        Update: {
          approver_type?: Database["public"]["Enums"]["approver_type"]
          approver_user_id?: string | null
          id?: string
          step_order?: number
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_workflow_steps_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_workflows: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_workflows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          created_at: string
          current_step: number
          id: string
          request_id: string
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          current_step?: number
          id?: string
          request_id: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          current_step?: number
          id?: string
          request_id?: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_rules: {
        Row: {
          assignee_ids: string[]
          created_at: string | null
          id: string
          is_active: boolean
          last_assigned_index: number
          name: string
          org_id: string | null
          priority_filter: string | null
          scope_id: string
          scope_type: string
          strategy: string
        }
        Insert: {
          assignee_ids?: string[]
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_assigned_index?: number
          name: string
          org_id?: string | null
          priority_filter?: string | null
          scope_id: string
          scope_type: string
          strategy?: string
        }
        Update: {
          assignee_ids?: string[]
          created_at?: string | null
          id?: string
          is_active?: boolean
          last_assigned_index?: number
          name?: string
          org_id?: string | null
          priority_filter?: string | null
          scope_id?: string
          scope_type?: string
          strategy?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          day_of_week: number
          end_time: string
          id: string
          is_active: boolean
          start_time: string
        }
        Insert: {
          day_of_week: number
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
        }
        Update: {
          day_of_week?: number
          end_time?: string
          id?: string
          is_active?: boolean
          start_time?: string
        }
        Relationships: []
      }
      business_rule_events: {
        Row: {
          fired_at: string
          id: string
          request_id: string
          rule_id: string
        }
        Insert: {
          fired_at?: string
          id?: string
          request_id: string
          rule_id: string
        }
        Update: {
          fired_at?: string
          id?: string
          request_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_rule_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_rule_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "business_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      business_rules: {
        Row: {
          actions: Json
          conditions: Json
          conditions_logic: string
          created_at: string
          created_by: string | null
          description: string | null
          execution_order: number
          id: string
          is_active: boolean
          last_assigned_index: number
          name: string
          org_id: string
          schedule_check: string | null
          schedule_threshold: number | null
          trigger: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actions?: Json
          conditions?: Json
          conditions_logic?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_order?: number
          id?: string
          is_active?: boolean
          last_assigned_index?: number
          name: string
          org_id: string
          schedule_check?: string | null
          schedule_threshold?: number | null
          trigger: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actions?: Json
          conditions?: Json
          conditions_logic?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_order?: number
          id?: string
          is_active?: boolean
          last_assigned_index?: number
          name?: string
          org_id?: string
          schedule_check?: string | null
          schedule_threshold?: number | null
          trigger?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string | null
          created_at: string | null
          department_id: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      csat_surveys: {
        Row: {
          comment: string | null
          id: string
          org_id: string
          rating: number | null
          request_id: string
          requester_id: string
          sent_at: string
          submitted_at: string | null
        }
        Insert: {
          comment?: string | null
          id?: string
          org_id: string
          rating?: number | null
          request_id: string
          requester_id: string
          sent_at?: string
          submitted_at?: string | null
        }
        Update: {
          comment?: string | null
          id?: string
          org_id?: string
          rating?: number | null
          request_id?: string
          requester_id?: string
          sent_at?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "csat_surveys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csat_surveys_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csat_surveys_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_roles: {
        Row: {
          base_role: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        Insert: {
          base_role?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
        }
        Update: {
          base_role?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_roles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string | null
          created_at: string
          head_user_id: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
          parent_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
          parent_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_head_user_id_fkey"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      designations: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "designations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desktime_app_logs: {
        Row: {
          app_name: string
          app_type: string
          created_at: string
          desktime_user_id: string
          id: string
          member_email: string | null
          member_name: string
          minutes: number
          org_id: string
          productivity: string
          updated_at: string
          work_date: string
        }
        Insert: {
          app_name?: string
          app_type?: string
          created_at?: string
          desktime_user_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          minutes?: number
          org_id: string
          productivity?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          app_name?: string
          app_type?: string
          created_at?: string
          desktime_user_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          minutes?: number
          org_id?: string
          productivity?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktime_app_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desktime_project_map: {
        Row: {
          created_at: string
          desktime_key: string
          desktime_project_name: string
          id: string
          org_id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          desktime_key: string
          desktime_project_name?: string
          id?: string
          org_id: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          desktime_key?: string
          desktime_project_name?: string
          id?: string
          org_id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktime_project_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desktime_project_map_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      desktime_sync_runs: {
        Row: {
          days_synced: number
          id: string
          matched_projects: number
          message: string | null
          org_id: string
          ran_at: string
          rows_upserted: number
          status: string
          triggered_by: string
        }
        Insert: {
          days_synced?: number
          id?: string
          matched_projects?: number
          message?: string | null
          org_id: string
          ran_at?: string
          rows_upserted?: number
          status?: string
          triggered_by?: string
        }
        Update: {
          days_synced?: number
          id?: string
          matched_projects?: number
          message?: string | null
          org_id?: string
          ran_at?: string
          rows_upserted?: number
          status?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktime_sync_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      desktime_time_logs: {
        Row: {
          created_at: string
          desktime_project_id: string
          desktime_project_name: string
          desktime_user_id: string
          id: string
          member_email: string | null
          member_name: string
          minutes: number
          org_id: string
          project_id: string | null
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          desktime_project_id?: string
          desktime_project_name?: string
          desktime_user_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          minutes?: number
          org_id: string
          project_id?: string | null
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          desktime_project_id?: string
          desktime_project_name?: string
          desktime_user_id?: string
          id?: string
          member_email?: string | null
          member_name?: string
          minutes?: number
          org_id?: string
          project_id?: string | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "desktime_time_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desktime_time_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      error_reports: {
        Row: {
          app: string
          created_at: string
          error_type: string
          id: string
          message: string
          metadata: Json | null
          org_id: string | null
          owner_note: string | null
          stack: string | null
          status: string
          updated_at: string
          url: string | null
          user_id: string | null
        }
        Insert: {
          app?: string
          created_at?: string
          error_type: string
          id?: string
          message: string
          metadata?: Json | null
          org_id?: string | null
          owner_note?: string | null
          stack?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          user_id?: string | null
        }
        Update: {
          app?: string
          created_at?: string
          error_type?: string
          id?: string
          message?: string
          metadata?: Json | null
          org_id?: string | null
          owner_note?: string | null
          stack?: string | null
          status?: string
          updated_at?: string
          url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_reports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_policies: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          rules: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          rules?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          rules?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      field_sla_overrides: {
        Row: {
          created_at: string
          field_id: string
          field_label: string
          id: string
          option_label: string
          option_value: string
          org_id: string
          service_id: string
          sla_config: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          field_label: string
          id?: string
          option_label: string
          option_value: string
          org_id: string
          service_id: string
          sla_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          field_label?: string
          id?: string
          option_label?: string
          option_value?: string
          org_id?: string
          service_id?: string
          sla_config?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_sla_overrides_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_sla_overrides_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_sla_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      global_sla_config: {
        Row: {
          escalation_pct: number
          id: string
          org_id: string
          priority: string
          resolution_hours: number | null
          response_hours: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          escalation_pct?: number
          id?: string
          org_id: string
          priority: string
          resolution_hours?: number | null
          response_hours?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          escalation_pct?: number
          id?: string
          org_id?: string
          priority?: string
          resolution_hours?: number | null
          response_hours?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_sla_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_sla_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string | null
          date: string
          id: string
          is_recurring: boolean
          name: string
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          is_recurring?: boolean
          name: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          is_recurring?: boolean
          name?: string
        }
        Relationships: []
      }
      intake_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number
          id: string
          message_id: string
          mime_type: string | null
          org_id: string
          scan_status: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size: number
          id?: string
          message_id: string
          mime_type?: string | null
          org_id: string
          scan_status?: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number
          id?: string
          message_id?: string
          mime_type?: string | null
          org_id?: string
          scan_status?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_channels: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          credentials_ref: string | null
          default_team_id: string | null
          id: string
          last_error: string | null
          last_polled_at: string | null
          name: string
          org_id: string
          provider: string | null
          status: Database["public"]["Enums"]["intake_channel_status"]
          type: Database["public"]["Enums"]["intake_channel_type"]
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials_ref?: string | null
          default_team_id?: string | null
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          name: string
          org_id: string
          provider?: string | null
          status?: Database["public"]["Enums"]["intake_channel_status"]
          type: Database["public"]["Enums"]["intake_channel_type"]
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          credentials_ref?: string | null
          default_team_id?: string | null
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          name?: string
          org_id?: string
          provider?: string | null
          status?: Database["public"]["Enums"]["intake_channel_status"]
          type?: Database["public"]["Enums"]["intake_channel_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_channels_default_team_id_fkey"
            columns: ["default_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_classifications: {
        Row: {
          confidence: number
          cost_microcents: number
          created_at: string
          entities: Json
          evidence: Json
          id: string
          is_final: boolean
          latency_ms: number | null
          message_id: string
          model_version: string | null
          org_id: string
          provider: string
          rationale: string | null
          stage: Database["public"]["Enums"]["intake_pipeline_stage"]
          suggested_category: string | null
          suggested_department: string | null
          suggested_priority:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_subcategory: string | null
          suggested_type: Database["public"]["Enums"]["intake_work_type"] | null
        }
        Insert: {
          confidence?: number
          cost_microcents?: number
          created_at?: string
          entities?: Json
          evidence?: Json
          id?: string
          is_final?: boolean
          latency_ms?: number | null
          message_id: string
          model_version?: string | null
          org_id: string
          provider: string
          rationale?: string | null
          stage: Database["public"]["Enums"]["intake_pipeline_stage"]
          suggested_category?: string | null
          suggested_department?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_subcategory?: string | null
          suggested_type?:
            | Database["public"]["Enums"]["intake_work_type"]
            | null
        }
        Update: {
          confidence?: number
          cost_microcents?: number
          created_at?: string
          entities?: Json
          evidence?: Json
          id?: string
          is_final?: boolean
          latency_ms?: number | null
          message_id?: string
          model_version?: string | null
          org_id?: string
          provider?: string
          rationale?: string | null
          stage?: Database["public"]["Enums"]["intake_pipeline_stage"]
          suggested_category?: string | null
          suggested_department?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_subcategory?: string | null
          suggested_type?:
            | Database["public"]["Enums"]["intake_work_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_classifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_classifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_messages: {
        Row: {
          body_html: string | null
          body_text: string | null
          cc_addresses: string[]
          channel_id: string
          created_at: string
          dedup_hash: string | null
          direction: string
          external_message_id: string | null
          from_address: string | null
          headers: Json
          id: string
          is_archived: boolean
          is_read: boolean
          normalized: Json | null
          org_id: string
          received_at: string | null
          recipient_type: string
          status: Database["public"]["Enums"]["intake_message_status"]
          subject: string | null
          thread_id: string | null
          to_addresses: string[]
          updated_at: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          channel_id: string
          created_at?: string
          dedup_hash?: string | null
          direction?: string
          external_message_id?: string | null
          from_address?: string | null
          headers?: Json
          id?: string
          is_archived?: boolean
          is_read?: boolean
          normalized?: Json | null
          org_id: string
          received_at?: string | null
          recipient_type?: string
          status?: Database["public"]["Enums"]["intake_message_status"]
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          channel_id?: string
          created_at?: string
          dedup_hash?: string | null
          direction?: string
          external_message_id?: string | null
          from_address?: string | null
          headers?: Json
          id?: string
          is_archived?: boolean
          is_read?: boolean
          normalized?: Json | null
          org_id?: string
          received_at?: string | null
          recipient_type?: string
          status?: Database["public"]["Enums"]["intake_message_status"]
          subject?: string | null
          thread_id?: string | null
          to_addresses?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "intake_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "intake_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          message_id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          message_id: string
          org_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          message_id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_notes_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_outbound: {
        Row: {
          action: string
          body_html: string | null
          body_text: string | null
          cc_addresses: string[]
          channel_id: string
          error: string | null
          id: string
          in_reply_to_id: string | null
          org_id: string
          sent_at: string
          sent_by: string | null
          status: string
          subject: string
          to_addresses: string[]
        }
        Insert: {
          action: string
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          channel_id: string
          error?: string | null
          id?: string
          in_reply_to_id?: string | null
          org_id: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          subject: string
          to_addresses?: string[]
        }
        Update: {
          action?: string
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: string[]
          channel_id?: string
          error?: string | null
          id?: string
          in_reply_to_id?: string | null
          org_id?: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          subject?: string
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "intake_outbound_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "intake_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_outbound_in_reply_to_id_fkey"
            columns: ["in_reply_to_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_outbound_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_outbound_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_pipeline_config: {
        Row: {
          config: Json
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config: Json
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_pipeline_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_pipeline_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_reviews: {
        Row: {
          assigned_reviewer_id: string | null
          classification_id: string | null
          created_approval_id: string | null
          created_at: string
          created_request_id: string | null
          created_task_id: string | null
          decision_notes: string | null
          escalation_note: string | null
          final_category: string | null
          final_department: string | null
          final_priority: Database["public"]["Enums"]["intake_priority"] | null
          final_subcategory: string | null
          final_type: Database["public"]["Enums"]["intake_work_type"] | null
          id: string
          is_escalated: boolean
          is_starred: boolean
          message_id: string
          org_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          state: Database["public"]["Enums"]["intake_review_state"]
          suggested_category: string | null
          suggested_category_id: string | null
          suggested_confidence: number | null
          suggested_department: string | null
          suggested_priority:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_service_id: string | null
          suggested_subcategory: string | null
          suggested_team_id: string | null
          suggested_type: Database["public"]["Enums"]["intake_work_type"] | null
          thread_id: string | null
          updated_at: string
          was_overridden: boolean
        }
        Insert: {
          assigned_reviewer_id?: string | null
          classification_id?: string | null
          created_approval_id?: string | null
          created_at?: string
          created_request_id?: string | null
          created_task_id?: string | null
          decision_notes?: string | null
          escalation_note?: string | null
          final_category?: string | null
          final_department?: string | null
          final_priority?: Database["public"]["Enums"]["intake_priority"] | null
          final_subcategory?: string | null
          final_type?: Database["public"]["Enums"]["intake_work_type"] | null
          id?: string
          is_escalated?: boolean
          is_starred?: boolean
          message_id: string
          org_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["intake_review_state"]
          suggested_category?: string | null
          suggested_category_id?: string | null
          suggested_confidence?: number | null
          suggested_department?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_service_id?: string | null
          suggested_subcategory?: string | null
          suggested_team_id?: string | null
          suggested_type?:
            | Database["public"]["Enums"]["intake_work_type"]
            | null
          thread_id?: string | null
          updated_at?: string
          was_overridden?: boolean
        }
        Update: {
          assigned_reviewer_id?: string | null
          classification_id?: string | null
          created_approval_id?: string | null
          created_at?: string
          created_request_id?: string | null
          created_task_id?: string | null
          decision_notes?: string | null
          escalation_note?: string | null
          final_category?: string | null
          final_department?: string | null
          final_priority?: Database["public"]["Enums"]["intake_priority"] | null
          final_subcategory?: string | null
          final_type?: Database["public"]["Enums"]["intake_work_type"] | null
          id?: string
          is_escalated?: boolean
          is_starred?: boolean
          message_id?: string
          org_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["intake_review_state"]
          suggested_category?: string | null
          suggested_category_id?: string | null
          suggested_confidence?: number | null
          suggested_department?: string | null
          suggested_priority?:
            | Database["public"]["Enums"]["intake_priority"]
            | null
          suggested_service_id?: string | null
          suggested_subcategory?: string | null
          suggested_team_id?: string | null
          suggested_type?:
            | Database["public"]["Enums"]["intake_work_type"]
            | null
          thread_id?: string | null
          updated_at?: string
          was_overridden?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_intake_reviews_created_approval"
            columns: ["created_approval_id"]
            isOneToOne: false
            referencedRelation: "approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_intake_reviews_created_request"
            columns: ["created_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_intake_reviews_created_task"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_assigned_reviewer_id_fkey"
            columns: ["assigned_reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "intake_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_suggested_category_id_fkey"
            columns: ["suggested_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_suggested_service_id_fkey"
            columns: ["suggested_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_suggested_team_id_fkey"
            columns: ["suggested_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_reviews_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "intake_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_rules: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          match_field: string
          match_keywords: string[]
          match_regex: string | null
          name: string
          org_id: string
          output_category: string | null
          output_department: string | null
          output_priority: string | null
          output_subcategory: string | null
          output_type: string | null
          updated_at: string
          updated_by: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          match_field?: string
          match_keywords?: string[]
          match_regex?: string | null
          name: string
          org_id: string
          output_category?: string | null
          output_department?: string | null
          output_priority?: string | null
          output_subcategory?: string | null
          output_type?: string | null
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          match_field?: string
          match_keywords?: string[]
          match_regex?: string | null
          name?: string
          org_id?: string
          output_category?: string | null
          output_department?: string | null
          output_priority?: string | null
          output_subcategory?: string | null
          output_type?: string | null
          updated_at?: string
          updated_by?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "intake_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_threads: {
        Row: {
          channel_id: string
          created_at: string
          external_thread_key: string | null
          first_message_at: string | null
          id: string
          last_message_at: string | null
          message_count: number
          org_id: string
          participant_emails: string[]
          status: Database["public"]["Enums"]["intake_thread_status"]
          subject: string | null
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          external_thread_key?: string | null
          first_message_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          org_id: string
          participant_emails?: string[]
          status?: Database["public"]["Enums"]["intake_thread_status"]
          subject?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          external_thread_key?: string | null
          first_message_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          org_id?: string
          participant_emails?: string[]
          status?: Database["public"]["Enums"]["intake_thread_status"]
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_threads_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "intake_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_functions: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_functions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_article_services: {
        Row: {
          article_id: string
          service_id: string
        }
        Insert: {
          article_id: string
          service_id: string
        }
        Update: {
          article_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_article_services_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "kb_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_article_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          author_id: string
          content: string
          created_at: string
          helpful_no: number
          helpful_yes: number
          id: string
          org_id: string
          slug: string
          status: Database["public"]["Enums"]["kb_article_status"]
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_id: string
          content?: string
          created_at?: string
          helpful_no?: number
          helpful_yes?: number
          id?: string
          org_id: string
          slug: string
          status?: Database["public"]["Enums"]["kb_article_status"]
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          helpful_no?: number
          helpful_yes?: number
          id?: string
          org_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["kb_article_status"]
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_articles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      license_keys: {
        Row: {
          expires_at: string
          id: string
          issued_at: string
          key_hash: string
          modules: Database["public"]["Enums"]["module_slug"][]
          notes: string | null
          org_id: string
          revoked_at: string | null
        }
        Insert: {
          expires_at: string
          id?: string
          issued_at?: string
          key_hash: string
          modules: Database["public"]["Enums"]["module_slug"][]
          notes?: string | null
          org_id: string
          revoked_at?: string | null
        }
        Update: {
          expires_at?: string
          id?: string
          issued_at?: string
          key_hash?: string
          modules?: Database["public"]["Enums"]["module_slug"][]
          notes?: string | null
          org_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "license_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          city: string | null
          code: string | null
          country: string | null
          created_at: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
          timezone: string | null
        }
        Insert: {
          city?: string | null
          code?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
          timezone?: string | null
        }
        Update: {
          city?: string | null
          code?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          created_by: string
          end_date: string | null
          functional_owner_id: string | null
          id: string
          name: string
          org_id: string
          owner_id: string | null
          percent_complete: number
          priority: Database["public"]["Enums"]["project_priority"]
          project_id: string
          sort_order: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          end_date?: string | null
          functional_owner_id?: string | null
          id?: string
          name: string
          org_id: string
          owner_id?: string | null
          percent_complete?: number
          priority?: Database["public"]["Enums"]["project_priority"]
          project_id: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          end_date?: string | null
          functional_owner_id?: string | null
          id?: string
          name?: string
          org_id?: string
          owner_id?: string | null
          percent_complete?: number
          priority?: Database["public"]["Enums"]["project_priority"]
          project_id?: string
          sort_order?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_functional_owner_id_fkey"
            columns: ["functional_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          enabled: boolean
          event_type: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          event_type: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          event_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          archived_at: string | null
          body: string | null
          created_at: string
          id: string
          link: string | null
          metadata: Json
          read_at: string | null
          request_id: string | null
          task_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          request_id?: string | null
          task_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          actor_id?: string | null
          archived_at?: string | null
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          request_id?: string | null
          task_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_module_access: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          module: Database["public"]["Enums"]["module_slug"]
          org_id: string
          seat_limit: number | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          module: Database["public"]["Enums"]["module_slug"]
          org_id: string
          seat_limit?: number | null
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          module?: Database["public"]["Enums"]["module_slug"]
          org_id?: string
          seat_limit?: number | null
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_module_access_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_signup_requests: {
        Row: {
          approved_org_id: string | null
          company_name: string
          company_size: string
          created_at: string
          email: string
          full_name: string
          id: string
          rejection_reason: string | null
          status: string
          updated_at: string
          use_case: string | null
        }
        Insert: {
          approved_org_id?: string | null
          company_name: string
          company_size: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          use_case?: string | null
        }
        Update: {
          approved_org_id?: string | null
          company_name?: string
          company_size?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          use_case?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_signup_requests_approved_org_id_fkey"
            columns: ["approved_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          desktime_connected_at: string | null
          desktime_credential_ref: string | null
          id: string
          is_owner: boolean
          name: string
          seat_limit: number
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          desktime_connected_at?: string | null
          desktime_credential_ref?: string | null
          id?: string
          is_owner?: boolean
          name: string
          seat_limit?: number
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          desktime_connected_at?: string | null
          desktime_credential_ref?: string | null
          id?: string
          is_owner?: boolean
          name?: string
          seat_limit?: number
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      owner_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_overrides: {
        Row: {
          action_key: string
          allowed: boolean
          id: string
          org_id: string
          role_key: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          action_key: string
          allowed: boolean
          id?: string
          org_id: string
          role_key: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          action_key?: string
          allowed?: boolean
          id?: string
          org_id?: string
          role_key?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_overrides_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cost_center_id: string | null
          created_at: string
          department_id: string | null
          designation_id: string | null
          employee_id: string | null
          full_name: string
          function_id: string | null
          id: string
          is_active: boolean
          job_title: string | null
          location_id: string | null
          manager_id: string | null
          org_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          cost_center_id?: string | null
          created_at?: string
          department_id?: string | null
          designation_id?: string | null
          employee_id?: string | null
          full_name: string
          function_id?: string | null
          id: string
          is_active?: boolean
          job_title?: string | null
          location_id?: string | null
          manager_id?: string | null
          org_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          cost_center_id?: string | null
          created_at?: string
          department_id?: string | null
          designation_id?: string | null
          employee_id?: string | null
          full_name?: string
          function_id?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          location_id?: string | null
          manager_id?: string | null
          org_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_function_id_fkey"
            columns: ["function_id"]
            isOneToOne: false
            referencedRelation: "job_functions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          org_id: string
          project_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id: string
          project_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_by: string
          joined_at: string
          org_id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_by: string
          joined_at?: string
          org_id: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          added_by?: string
          joined_at?: string
          org_id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          author_id: string
          blockers: string | null
          created_at: string
          id: string
          org_id: string
          percent_snapshot: number
          project_id: string
          update_date: string
          update_text: string
        }
        Insert: {
          author_id: string
          blockers?: string | null
          created_at?: string
          id?: string
          org_id: string
          percent_snapshot?: number
          project_id: string
          update_date: string
          update_text: string
        }
        Update: {
          author_id?: string
          blockers?: string | null
          created_at?: string
          id?: string
          org_id?: string
          percent_snapshot?: number
          project_id?: string
          update_date?: string
          update_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_updates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string | null
          functional_owner_id: string | null
          id: string
          name: string
          org_id: string
          owner_id: string
          priority: Database["public"]["Enums"]["project_priority"]
          reference_notes: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_date: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          functional_owner_id?: string | null
          id?: string
          name: string
          org_id: string
          owner_id: string
          priority?: Database["public"]["Enums"]["project_priority"]
          reference_notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          functional_owner_id?: string | null
          id?: string
          name?: string
          org_id?: string
          owner_id?: string
          priority?: Database["public"]["Enums"]["project_priority"]
          reference_notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_date?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_functional_owner_id_fkey"
            columns: ["functional_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      related_requests: {
        Row: {
          created_at: string
          created_by: string
          id: string
          link_type: string
          org_id: string
          related_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          link_type?: string
          org_id: string
          related_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          link_type?: string
          org_id?: string
          related_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_requests_related_id_fkey"
            columns: ["related_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_requests_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_activity: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          request_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_activity_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_attachments: {
        Row: {
          comment_id: string | null
          deleted_at: string | null
          file_name: string
          file_size: number
          id: string
          is_internal: boolean
          mime_type: string
          request_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          comment_id?: string | null
          deleted_at?: string | null
          file_name: string
          file_size: number
          id?: string
          is_internal?: boolean
          mime_type: string
          request_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          comment_id?: string | null
          deleted_at?: string | null
          file_name?: string
          file_size?: number
          id?: string
          is_internal?: boolean
          mime_type?: string
          request_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "request_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_collaborators: {
        Row: {
          added_at: string | null
          added_by: string
          id: string
          request_id: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          added_by: string
          id?: string
          request_id: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string
          id?: string
          request_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_collaborators_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
          request_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          request_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_priorities: {
        Row: {
          color: string
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          name: string
          sla_multiplier: number
          value: string
        }
        Insert: {
          color?: string
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          sla_multiplier?: number
          value: string
        }
        Update: {
          color?: string
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sla_multiplier?: number
          value?: string
        }
        Relationships: []
      }
      request_sequences: {
        Row: {
          last_no: number
          prefix: string
        }
        Insert: {
          last_no?: number
          prefix: string
        }
        Update: {
          last_no?: number
          prefix?: string
        }
        Relationships: []
      }
      request_time_entries: {
        Row: {
          created_at: string
          id: string
          note: string | null
          request_id: string
          started_at: string
          stopped_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          request_id: string
          started_at?: string
          stopped_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          request_id?: string
          started_at?: string
          stopped_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_time_entries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string
          description: string | null
          form_data: Json
          form_schema_snapshot: Json
          form_sections_snapshot: Json
          id: string
          intake_message_id: string | null
          org_id: string | null
          parent_request_id: string | null
          priority: Database["public"]["Enums"]["request_priority"]
          project_id: string | null
          request_no: string
          requester_id: string
          resolution_due_at: string | null
          resolved_at: string | null
          responded_at: string | null
          response_due_at: string | null
          service_id: string
          source_metadata: Json | null
          status: Database["public"]["Enums"]["request_status"]
          team_id: string
          title: string
          updated_at: string
          waiting_since: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          form_data?: Json
          form_schema_snapshot?: Json
          form_sections_snapshot?: Json
          id?: string
          intake_message_id?: string | null
          org_id?: string | null
          parent_request_id?: string | null
          priority?: Database["public"]["Enums"]["request_priority"]
          project_id?: string | null
          request_no: string
          requester_id: string
          resolution_due_at?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          response_due_at?: string | null
          service_id: string
          source_metadata?: Json | null
          status?: Database["public"]["Enums"]["request_status"]
          team_id: string
          title: string
          updated_at?: string
          waiting_since?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          description?: string | null
          form_data?: Json
          form_schema_snapshot?: Json
          form_sections_snapshot?: Json
          id?: string
          intake_message_id?: string | null
          org_id?: string | null
          parent_request_id?: string | null
          priority?: Database["public"]["Enums"]["request_priority"]
          project_id?: string | null
          request_no?: string
          requester_id?: string
          resolution_due_at?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          response_due_at?: string | null
          service_id?: string
          source_metadata?: Json | null
          status?: Database["public"]["Enums"]["request_status"]
          team_id?: string
          title?: string
          updated_at?: string
          waiting_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_intake_message_id_fkey"
            columns: ["intake_message_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_parent_request_id_fkey"
            columns: ["parent_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          archive_after_days: number | null
          entity_type: string
          id: string
          is_active: boolean
          purge_after_days: number | null
          retention_days: number
          updated_at: string | null
        }
        Insert: {
          archive_after_days?: number | null
          entity_type: string
          id?: string
          is_active?: boolean
          purge_after_days?: number | null
          retention_days?: number
          updated_at?: string | null
        }
        Update: {
          archive_after_days?: number | null
          entity_type?: string
          id?: string
          is_active?: boolean
          purge_after_days?: number | null
          retention_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      scheduled_reports: {
        Row: {
          created_at: string | null
          created_by: string | null
          filters: Json
          frequency: Database["public"]["Enums"]["report_frequency"]
          id: string
          is_active: boolean
          last_sent_at: string | null
          name: string
          next_run_at: string | null
          org_id: string | null
          recipients: string[]
          report_type: Database["public"]["Enums"]["report_type_enum"]
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          filters?: Json
          frequency?: Database["public"]["Enums"]["report_frequency"]
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name: string
          next_run_at?: string | null
          org_id?: string | null
          recipients?: string[]
          report_type: Database["public"]["Enums"]["report_type_enum"]
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          filters?: Json
          frequency?: Database["public"]["Enums"]["report_frequency"]
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name?: string
          next_run_at?: string | null
          org_id?: string | null
          recipients?: string[]
          report_type?: Database["public"]["Enums"]["report_type_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_sub_categories: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_sub_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          approval_workflow_id: string | null
          backup_owner_id: string | null
          category_id: string
          created_at: string
          default_priority: Database["public"]["Enums"]["request_priority"]
          description: string | null
          escalation_policy_id: string | null
          form_fields: Json
          form_sections: Json
          icon: string | null
          id: string
          is_active: boolean
          keywords: string[]
          name: string
          org_id: string | null
          owner_id: string | null
          sla_config: Json
          slug: string
          sort_order: number
          status: string
          sub_category_id: string | null
          team_id: string
          updated_at: string
          version: string
          visibility: string
          visibility_scope: Json
        }
        Insert: {
          approval_workflow_id?: string | null
          backup_owner_id?: string | null
          category_id: string
          created_at?: string
          default_priority?: Database["public"]["Enums"]["request_priority"]
          description?: string | null
          escalation_policy_id?: string | null
          form_fields?: Json
          form_sections?: Json
          icon?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name: string
          org_id?: string | null
          owner_id?: string | null
          sla_config?: Json
          slug: string
          sort_order?: number
          status?: string
          sub_category_id?: string | null
          team_id: string
          updated_at?: string
          version?: string
          visibility?: string
          visibility_scope?: Json
        }
        Update: {
          approval_workflow_id?: string | null
          backup_owner_id?: string | null
          category_id?: string
          created_at?: string
          default_priority?: Database["public"]["Enums"]["request_priority"]
          description?: string | null
          escalation_policy_id?: string | null
          form_fields?: Json
          form_sections?: Json
          icon?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          name?: string
          org_id?: string | null
          owner_id?: string | null
          sla_config?: Json
          slug?: string
          sort_order?: number
          status?: string
          sub_category_id?: string | null
          team_id?: string
          updated_at?: string
          version?: string
          visibility?: string
          visibility_scope?: Json
        }
        Relationships: [
          {
            foreignKeyName: "services_approval_workflow_id_fkey"
            columns: ["approval_workflow_id"]
            isOneToOne: false
            referencedRelation: "approval_workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_backup_owner_id_fkey"
            columns: ["backup_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_escalation_policy_id_fkey"
            columns: ["escalation_policy_id"]
            isOneToOne: false
            referencedRelation: "escalation_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_sub_category_id_fkey"
            columns: ["sub_category_id"]
            isOneToOne: false
            referencedRelation: "service_sub_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_escalation_events: {
        Row: {
          fired_at: string
          id: string
          request_id: string
          rule_id: string
        }
        Insert: {
          fired_at?: string
          id?: string
          request_id: string
          rule_id: string
        }
        Update: {
          fired_at?: string
          id?: string
          request_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_escalation_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_escalation_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "sla_escalation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_escalation_rules: {
        Row: {
          created_at: string | null
          id: string
          name: string
          notify_roles: string[]
          tier: string
          trigger_pct: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          notify_roles?: string[]
          tier: string
          trigger_pct?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          notify_roles?: string[]
          tier?: string
          trigger_pct?: number
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string
          created_at: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          action: Database["public"]["Enums"]["task_activity_action"]
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          task_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["task_activity_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["task_activity_action"]
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          added_at: string
          added_by: string | null
          task_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          task_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string | null
          file_name: string
          file_size: number
          id: string
          mime_type: string
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_size: number
          id?: string
          mime_type: string
          storage_path: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          storage_path?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          is_internal: boolean
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_custom_field_values: {
        Row: {
          field_id: string
          id: string
          task_id: string
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          field_id: string
          id?: string
          task_id: string
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          field_id?: string
          id?: string
          task_id?: string
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "task_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "task_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_field_values_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_custom_fields: {
        Row: {
          created_at: string | null
          created_by: string | null
          field_type: Database["public"]["Enums"]["custom_field_type"]
          id: string
          name: string
          options: Json | null
          position: number
          team_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          field_type?: Database["public"]["Enums"]["custom_field_type"]
          id?: string
          name: string
          options?: Json | null
          position?: number
          team_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          field_type?: Database["public"]["Enums"]["custom_field_type"]
          id?: string
          name?: string
          options?: Json | null
          position?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_custom_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_fields_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string
          depends_on_task_id: string
          id: string
          org_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          depends_on_task_id: string
          id?: string
          org_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          depends_on_task_id?: string
          id?: string
          org_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_priorities: {
        Row: {
          color: string
          created_at: string | null
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          name: string
          value: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          value: string
        }
        Update: {
          color?: string
          created_at?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          value?: string
        }
        Relationships: []
      }
      task_statuses: {
        Row: {
          color: string
          created_at: string | null
          display_order: number
          id: string
          is_active: boolean
          is_terminal: boolean
          name: string
          value: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_terminal?: boolean
          name: string
          value: string
        }
        Update: {
          color?: string
          created_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_terminal?: boolean
          name?: string
          value?: string
        }
        Relationships: []
      }
      task_template_items: {
        Row: {
          created_at: string | null
          default_priority: string
          description: string | null
          due_offset_days: number | null
          id: string
          position: number
          template_id: string
          title: string
        }
        Insert: {
          created_at?: string | null
          default_priority?: string
          description?: string | null
          due_offset_days?: number | null
          id?: string
          position?: number
          template_id: string
          title: string
        }
        Update: {
          created_at?: string | null
          default_priority?: string
          description?: string | null
          due_offset_days?: number | null
          id?: string
          position?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          intake_message_id: string | null
          milestone_id: string | null
          org_id: string | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          request_id: string | null
          source_metadata: Json | null
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[]
          task_type: Database["public"]["Enums"]["task_type"]
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          intake_message_id?: string | null
          milestone_id?: string | null
          org_id?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          request_id?: string | null
          source_metadata?: Json | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[]
          task_type?: Database["public"]["Enums"]["task_type"]
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          intake_message_id?: string | null
          milestone_id?: string | null
          org_id?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          request_id?: string | null
          source_metadata?: Json | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[]
          task_type?: Database["public"]["Enums"]["task_type"]
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_intake_message_id_fkey"
            columns: ["intake_message_id"]
            isOneToOne: false
            referencedRelation: "intake_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          is_lead: boolean
          joined_at: string
          org_id: string
          team_id: string
          user_id: string
        }
        Insert: {
          is_lead?: boolean
          joined_at?: string
          org_id: string
          team_id: string
          user_id: string
        }
        Update: {
          is_lead?: boolean
          joined_at?: string
          org_id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          name: string
          notification_email: string | null
          org_id: string | null
          prefix: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          name: string
          notification_email?: string | null
          org_id?: string | null
          prefix: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          name?: string
          notification_email?: string | null
          org_id?: string | null
          prefix?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_collaborators: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      can_view_project: { Args: { p_project_id: string }; Returns: boolean }
      current_org_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_user_team_ids: { Args: never; Returns: string[] }
      generate_request_no: { Args: { p_prefix: string }; Returns: string }
      get_enabled_modules: {
        Args: never
        Returns: Database["public"]["Enums"]["module_slug"][]
      }
      get_home_dashboard: {
        Args: {
          p_has_tasks?: boolean
          p_is_agent?: boolean
          p_is_manager?: boolean
          p_team_id?: string
        }
        Returns: Json
      }
      has_module_access: {
        Args: { p_module: Database["public"]["Enums"]["module_slug"] }
        Returns: boolean
      }
      intake_read_credential: { Args: { p_ref: string }; Returns: string }
      intake_store_credential: {
        Args: { p_channel_id: string; p_secret: string }
        Returns: string
      }
      intake_validation_stats: { Args: never; Returns: Json }
      is_agent: { Args: never; Returns: boolean }
      is_owner_org: { Args: never; Returns: boolean }
      is_request_collaborator: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      is_team_member: { Args: { p_team_id: string }; Returns: boolean }
      merge_request_form_data: {
        Args: { p_patch: Json; p_request_id: string }
        Returns: undefined
      }
      org_read_desktime_key: { Args: { p_ref: string }; Returns: string }
      org_store_desktime_key: {
        Args: { p_org_id: string; p_secret: string }
        Returns: string
      }
      owner_delete_org: { Args: { p_org_id: string }; Returns: Json }
      seed_default_sla_config: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      upsert_field_sla_override: {
        Args: {
          p_field_id: string
          p_field_label: string
          p_option_label: string
          p_option_value: string
          p_org_id: string
          p_priority: string
          p_resolution_hours: number
          p_response_hours: number
          p_service_id: string
          p_updated_by: string
        }
        Returns: undefined
      }
    }
    Enums: {
      activity_action:
        | "created"
        | "assigned"
        | "unassigned"
        | "status_changed"
        | "priority_changed"
        | "resolved"
        | "closed"
        | "reopened"
        | "cancelled"
        | "approval_requested"
        | "approved"
        | "rejected"
        | "comment_added"
        | "attachment_added"
        | "collaborator_added"
        | "collaborator_removed"
        | "reclassified"
        | "form_data_updated"
      approval_decision_type: "approved" | "rejected"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      approver_type: "specific_user" | "any_manager"
      custom_field_type:
        | "text"
        | "number"
        | "date"
        | "dropdown"
        | "multi_select"
        | "checkbox"
      intake_channel_status: "active" | "paused" | "error"
      intake_channel_type:
        | "email"
        | "portal"
        | "whatsapp"
        | "teams"
        | "slack"
        | "api"
      intake_message_status:
        | "new"
        | "normalized"
        | "classified"
        | "in_review"
        | "actioned"
        | "rejected"
        | "duplicate"
      intake_pipeline_stage: "rule" | "local_model" | "premium_ai" | "manual"
      intake_priority: "low" | "medium" | "high" | "urgent"
      intake_review_state:
        | "pending"
        | "in_review"
        | "approved"
        | "rejected"
        | "converted"
      intake_thread_status: "open" | "linked" | "closed"
      intake_work_type:
        | "request"
        | "task"
        | "approval"
        | "ignore"
        | "informational"
      kb_article_status: "draft" | "published" | "archived"
      module_slug:
        | "requests"
        | "tasks"
        | "approvals"
        | "services"
        | "time_tracking"
        | "analytics"
        | "integrations"
        | "intake"
        | "projects"
      notification_type:
        | "request_assigned"
        | "comment_added"
        | "approval_requested"
        | "approval_decided"
        | "request_resolved"
        | "request_closed"
        | "task_assigned"
        | "request_reopened"
        | "request_created"
        | "internal_note_added"
        | "request_reassigned"
        | "collaborator_added"
        | "collaborator_removed"
        | "approval_approved"
        | "approval_rejected"
        | "request_auto_closed"
        | "request_cancelled"
        | "priority_changed"
        | "status_changed"
        | "sla_warning"
        | "sla_breached"
        | "mentioned"
        | "request_unassigned"
        | "task_completed"
        | "milestone_due_soon"
        | "milestone_overdue"
        | "task_due_soon"
        | "task_overdue"
        | "daily_digest"
        | "business_rule_notification"
      org_status: "trial" | "active" | "suspended" | "cancelled"
      project_priority: "P1" | "P2" | "P3"
      project_status:
        | "not_started"
        | "in_progress"
        | "blocked"
        | "done"
        | "cancelled"
      report_frequency: "daily" | "weekly" | "monthly"
      report_type_enum: "requests" | "tasks" | "approvals"
      request_priority: "low" | "medium" | "high" | "urgent"
      request_status:
        | "pending_approval"
        | "open"
        | "assigned"
        | "in_progress"
        | "waiting_user"
        | "resolved"
        | "closed"
        | "cancelled"
      task_activity_action:
        | "created"
        | "assigned"
        | "unassigned"
        | "status_changed"
        | "comment_added"
        | "completed"
        | "reopened"
        | "cancelled"
      task_priority: "low" | "medium" | "high"
      task_status: "open" | "in_progress" | "done" | "cancelled"
      task_type: "personal" | "team"
      user_role: "user" | "manager" | "admin" | "agent" | "platform_owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_action: [
        "created",
        "assigned",
        "unassigned",
        "status_changed",
        "priority_changed",
        "resolved",
        "closed",
        "reopened",
        "cancelled",
        "approval_requested",
        "approved",
        "rejected",
        "comment_added",
        "attachment_added",
        "collaborator_added",
        "collaborator_removed",
        "reclassified",
        "form_data_updated",
      ],
      approval_decision_type: ["approved", "rejected"],
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      approver_type: ["specific_user", "any_manager"],
      custom_field_type: [
        "text",
        "number",
        "date",
        "dropdown",
        "multi_select",
        "checkbox",
      ],
      intake_channel_status: ["active", "paused", "error"],
      intake_channel_type: [
        "email",
        "portal",
        "whatsapp",
        "teams",
        "slack",
        "api",
      ],
      intake_message_status: [
        "new",
        "normalized",
        "classified",
        "in_review",
        "actioned",
        "rejected",
        "duplicate",
      ],
      intake_pipeline_stage: ["rule", "local_model", "premium_ai", "manual"],
      intake_priority: ["low", "medium", "high", "urgent"],
      intake_review_state: [
        "pending",
        "in_review",
        "approved",
        "rejected",
        "converted",
      ],
      intake_thread_status: ["open", "linked", "closed"],
      intake_work_type: [
        "request",
        "task",
        "approval",
        "ignore",
        "informational",
      ],
      kb_article_status: ["draft", "published", "archived"],
      module_slug: [
        "requests",
        "tasks",
        "approvals",
        "services",
        "time_tracking",
        "analytics",
        "integrations",
        "intake",
        "projects",
      ],
      notification_type: [
        "request_assigned",
        "comment_added",
        "approval_requested",
        "approval_decided",
        "request_resolved",
        "request_closed",
        "task_assigned",
        "request_reopened",
        "request_created",
        "internal_note_added",
        "request_reassigned",
        "collaborator_added",
        "collaborator_removed",
        "approval_approved",
        "approval_rejected",
        "request_auto_closed",
        "request_cancelled",
        "priority_changed",
        "status_changed",
        "sla_warning",
        "sla_breached",
        "mentioned",
        "request_unassigned",
        "task_completed",
        "milestone_due_soon",
        "milestone_overdue",
        "task_due_soon",
        "task_overdue",
        "daily_digest",
        "business_rule_notification",
      ],
      org_status: ["trial", "active", "suspended", "cancelled"],
      project_priority: ["P1", "P2", "P3"],
      project_status: [
        "not_started",
        "in_progress",
        "blocked",
        "done",
        "cancelled",
      ],
      report_frequency: ["daily", "weekly", "monthly"],
      report_type_enum: ["requests", "tasks", "approvals"],
      request_priority: ["low", "medium", "high", "urgent"],
      request_status: [
        "pending_approval",
        "open",
        "assigned",
        "in_progress",
        "waiting_user",
        "resolved",
        "closed",
        "cancelled",
      ],
      task_activity_action: [
        "created",
        "assigned",
        "unassigned",
        "status_changed",
        "comment_added",
        "completed",
        "reopened",
        "cancelled",
      ],
      task_priority: ["low", "medium", "high"],
      task_status: ["open", "in_progress", "done", "cancelled"],
      task_type: ["personal", "team"],
      user_role: ["user", "manager", "admin", "agent", "platform_owner"],
    },
  },
} as const

