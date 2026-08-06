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
      business_hours: {
        Row: {
          id: string
          day_of_week: number
          start_time: string
          end_time: string
          is_active: boolean
        }
        Insert: {
          id?: string
          day_of_week: number
          start_time?: string
          end_time?: string
          is_active?: boolean
        }
        Update: {
          id?: string
          day_of_week?: number
          start_time?: string
          end_time?: string
          is_active?: boolean
        }
        Relationships: []
      }
      holidays: {
        Row: {
          id: string
          name: string
          date: string
          is_recurring: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          date: string
          is_recurring?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          date?: string
          is_recurring?: boolean
          created_at?: string
        }
        Relationships: []
      }
      sla_escalation_rules: {
        Row: {
          id: string
          name: string
          tier: string
          trigger_pct: number
          notify_roles: string[]
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          tier: string
          trigger_pct?: number
          notify_roles?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          tier?: string
          trigger_pct?: number
          notify_roles?: string[]
          created_at?: string
        }
        Relationships: []
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
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
            isOneToOne: true
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
      departments: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
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
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          seat_limit: number
          trial_ends_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          seat_limit?: number
          trial_ends_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          seat_limit?: number
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      org_module_access: {
        Row: {
          id: string
          org_id: string
          module: Database["public"]["Enums"]["module_slug"]
          enabled: boolean
          seat_limit: number | null
          valid_from: string
          valid_until: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          module: Database["public"]["Enums"]["module_slug"]
          enabled?: boolean
          seat_limit?: number | null
          valid_from?: string
          valid_until?: string | null
          created_at?: string
        }
        Update: {
          enabled?: boolean
          seat_limit?: number | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          org_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          org_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          org_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
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
      request_collaborators: {
        Row: {
          added_at: string
          added_by: string
          id: string
          request_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          id?: string
          request_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          id?: string
          request_id?: string
          user_id?: string
        }
        Relationships: [
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
          {
            foreignKeyName: "request_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_attachments: {
        Row: {
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
          priority: Database["public"]["Enums"]["request_priority"]
          request_no: string
          requester_id: string
          resolution_due_at: string | null
          resolved_at: string | null
          responded_at: string | null
          response_due_at: string | null
          service_id: string
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
          priority?: Database["public"]["Enums"]["request_priority"]
          request_no: string
          requester_id: string
          resolution_due_at?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          response_due_at?: string | null
          service_id: string
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
          priority?: Database["public"]["Enums"]["request_priority"]
          request_no?: string
          requester_id?: string
          resolution_due_at?: string | null
          resolved_at?: string | null
          responded_at?: string | null
          response_due_at?: string | null
          service_id?: string
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
      service_categories: {
        Row: {
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
        Relationships: []
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
          owner_id: string | null
          sla_config: Json
          slug: string
          sort_order: number
          sub_category_id: string | null
          team_id: string
          updated_at: string
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
          owner_id?: string | null
          sla_config?: Json
          slug: string
          sort_order?: number
          sub_category_id?: string | null
          team_id: string
          updated_at?: string
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
          owner_id?: string | null
          sla_config?: Json
          slug?: string
          sort_order?: number
          sub_category_id?: string | null
          team_id?: string
          updated_at?: string
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
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          request_id: string | null
          status: Database["public"]["Enums"]["task_status"]
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
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          request_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
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
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          request_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
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
          team_id: string
          user_id: string
        }
        Insert: {
          is_lead?: boolean
          joined_at?: string
          team_id: string
          user_id: string
        }
        Update: {
          is_lead?: boolean
          joined_at?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
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
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      generate_request_no: { Args: { p_prefix: string }; Returns: string }
      is_agent: { Args: never; Returns: boolean }
      is_team_member: { Args: { p_team_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      get_enabled_modules: { Args: never; Returns: Database["public"]["Enums"]["module_slug"][] }
    }
    Enums: {
      org_status: "trial" | "active" | "suspended" | "cancelled"
      module_slug:
        | "requests"
        | "tasks"
        | "approvals"
        | "services"
        | "time_tracking"
        | "analytics"
        | "integrations"
        | "intake"
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
      approval_decision_type: "approved" | "rejected"
      approval_status: "pending" | "approved" | "rejected" | "cancelled"
      approver_type: "specific_user" | "any_manager"
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
      user_role: "user" | "agent" | "manager" | "admin" | "platform_owner"
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
      ],
      approval_decision_type: ["approved", "rejected"],
      approval_status: ["pending", "approved", "rejected", "cancelled"],
      approver_type: ["specific_user", "any_manager"],
      notification_type: [
        "request_assigned",
        "request_unassigned",
        "comment_added",
        "approval_requested",
        "approval_decided",
        "request_resolved",
        "request_closed",
        "task_assigned",
        "request_reopened",
      ],
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
      user_role: ["user", "agent", "manager", "admin", "platform_owner"],
    },
  },
} as const

