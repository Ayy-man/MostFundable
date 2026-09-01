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
      admin_layouts: {
        Row: {
          layout: Json
          profile_id: string
          updated_at: string
        }
        Insert: {
          layout: Json
          profile_id: string
          updated_at?: string
        }
        Update: {
          layout?: Json
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_layouts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_client_shares: {
        Row: {
          affiliate_id: string
          client_id: string
          commission_override: boolean
          expected_commission_cents: number | null
          payment_status: Database["public"]["Enums"]["affiliate_payment_status"]
        }
        Insert: {
          affiliate_id: string
          client_id: string
          commission_override?: boolean
          expected_commission_cents?: number | null
          payment_status?: Database["public"]["Enums"]["affiliate_payment_status"]
        }
        Update: {
          affiliate_id?: string
          client_id?: string
          commission_override?: boolean
          expected_commission_cents?: number | null
          payment_status?: Database["public"]["Enums"]["affiliate_payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_client_shares_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_client_shares_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_client_shares_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          default_commission_bps: number
          id: string
          name: string
          org_id: string
          profile_id: string | null
          referral_slug: string
        }
        Insert: {
          default_commission_bps?: number
          id?: string
          name: string
          org_id: string
          profile_id?: string | null
          referral_slug: string
        }
        Update: {
          default_commission_bps?: number
          id?: string
          name?: string
          org_id?: string
          profile_id?: string | null
          referral_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliates_profile_org_fk"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      analysis_jobs: {
        Row: {
          analysis_run_id: string
          attempt_count: number
          available_at: string
          client_id: string
          created_at: string
          error_code:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status: Database["public"]["Enums"]["analysis_job_status"]
          subject: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at: string
          window: string | null
        }
        Insert: {
          analysis_run_id?: string
          attempt_count?: number
          available_at?: string
          client_id: string
          created_at?: string
          error_code?:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status?: Database["public"]["Enums"]["analysis_job_status"]
          subject?: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at?: string
          window?: string | null
        }
        Update: {
          analysis_run_id?: string
          attempt_count?: number
          available_at?: string
          client_id?: string
          created_at?: string
          error_code?:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          source_id?: string
          source_kind?: Database["public"]["Enums"]["analysis_job_source_kind"]
          status?: Database["public"]["Enums"]["analysis_job_status"]
          subject?: string | null
          trigger?: Database["public"]["Enums"]["analysis_trigger"]
          updated_at?: string
          window?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_runs: {
        Row: {
          client_id: string
          derived: Json
          id: string
          ran_at: string
          readiness_score: number
          trigger: Database["public"]["Enums"]["analysis_trigger"]
        }
        Insert: {
          client_id: string
          derived: Json
          id?: string
          ran_at?: string
          readiness_score: number
          trigger: Database["public"]["Enums"]["analysis_trigger"]
        }
        Update: {
          client_id?: string
          derived?: Json
          id?: string
          ran_at?: string
          readiness_score?: number
          trigger?: Database["public"]["Enums"]["analysis_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      application_notes: {
        Row: {
          application_id: string
          attested: boolean
          author_kind: Database["public"]["Enums"]["application_note_author_kind"]
          author_profile_id: string
          body: string
          created_at: string
          id: string
        }
        Insert: {
          application_id: string
          attested?: boolean
          author_kind: Database["public"]["Enums"]["application_note_author_kind"]
          author_profile_id: string
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          application_id?: string
          attested?: boolean
          author_kind?: Database["public"]["Enums"]["application_note_author_kind"]
          author_profile_id?: string
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_notes_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          amount_cents: number | null
          bank_ref: string
          client_id: string
          consumer_status: Database["public"]["Enums"]["application_consumer_status"]
          created_at: string
          created_by: string | null
          id: string
          operator_status: Database["public"]["Enums"]["application_operator_status"]
          updated_at: string
          visibility: Database["public"]["Enums"]["application_visibility"]
        }
        Insert: {
          amount_cents?: number | null
          bank_ref: string
          client_id: string
          consumer_status?: Database["public"]["Enums"]["application_consumer_status"]
          created_at?: string
          created_by?: string | null
          id?: string
          operator_status?: Database["public"]["Enums"]["application_operator_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["application_visibility"]
        }
        Update: {
          amount_cents?: number | null
          bank_ref?: string
          client_id?: string
          consumer_status?: Database["public"]["Enums"]["application_consumer_status"]
          created_at?: string
          created_by?: string | null
          id?: string
          operator_status?: Database["public"]["Enums"]["application_operator_status"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["application_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          client_id: string | null
          id: string
          meta: Json
          occurred_at: string
          org_id: string | null
          subject_id: string
          subject_type: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          client_id?: string | null
          id?: string
          meta?: Json
          occurred_at?: string
          org_id?: string | null
          subject_id: string
          subject_type: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          client_id?: string | null
          id?: string
          meta?: Json
          occurred_at?: string
          org_id?: string | null
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          execution_started_at: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          rows_processed: number | null
          status: Database["public"]["Enums"]["background_job_status"]
          subject: string
          updated_at: string
          window: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          execution_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          job: string
          lease_owner?: string | null
          lease_until?: string | null
          rows_processed?: number | null
          status?: Database["public"]["Enums"]["background_job_status"]
          subject: string
          updated_at?: string
          window: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          execution_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          rows_processed?: number | null
          status?: Database["public"]["Enums"]["background_job_status"]
          subject?: string
          updated_at?: string
          window?: string
        }
        Relationships: []
      }
      bank_outcome_stats: {
        Row: {
          approved_amount_cents_total: number
          bank_ref: string
          computed_at: string
          heat_level: string
          last_outcome_at: string | null
          outcome_count_total: number
          stats_version: number
          windows: Json
        }
        Insert: {
          approved_amount_cents_total?: number
          bank_ref: string
          computed_at?: string
          heat_level: string
          last_outcome_at?: string | null
          outcome_count_total?: number
          stats_version?: number
          windows: Json
        }
        Update: {
          approved_amount_cents_total?: number
          bank_ref?: string
          computed_at?: string
          heat_level?: string
          last_outcome_at?: string | null
          outcome_count_total?: number
          stats_version?: number
          windows?: Json
        }
        Relationships: []
      }
      bank_retrieval_index: {
        Row: {
          bank_ref: string
          document: Json
          document_fingerprint: string
          rebuilt_at: string
          stats_version: number
        }
        Insert: {
          bank_ref: string
          document: Json
          document_fingerprint: string
          rebuilt_at?: string
          stats_version: number
        }
        Update: {
          bank_ref?: string
          document?: Json
          document_fingerprint?: string
          rebuilt_at?: string
          stats_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bank_retrieval_index_stats_fk"
            columns: ["bank_ref", "stats_version"]
            isOneToOne: false
            referencedRelation: "bank_outcome_stats"
            referencedColumns: ["bank_ref", "stats_version"]
          },
        ]
      }
      billing_refund_attributions: {
        Row: {
          id: string
          observation_id: string
          org_id: string
          resolved_at: string
          source: string
        }
        Insert: {
          id?: string
          observation_id: string
          org_id: string
          resolved_at?: string
          source: string
        }
        Update: {
          id?: string
          observation_id?: string
          org_id?: string
          resolved_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_refund_attributions_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: true
            referencedRelation: "billing_refund_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refund_attributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refund_attributions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_refund_observations: {
        Row: {
          charge_ref: string
          cumulative_amount_refunded_cents: number
          currency: string
          customer_ref: string | null
          event_id: string
          id: string
          occurred_at: string
          org_id: string | null
          recorded_at: string
          subscription_ref: string | null
        }
        Insert: {
          charge_ref: string
          cumulative_amount_refunded_cents: number
          currency: string
          customer_ref?: string | null
          event_id: string
          id?: string
          occurred_at: string
          org_id?: string | null
          recorded_at?: string
          subscription_ref?: string | null
        }
        Update: {
          charge_ref?: string
          cumulative_amount_refunded_cents?: number
          currency?: string
          customer_ref?: string | null
          event_id?: string
          id?: string
          occurred_at?: string
          org_id?: string | null
          recorded_at?: string
          subscription_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_refund_observations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "stripe_webhook_events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "billing_refund_observations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_refund_observations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_item_state: {
        Row: {
          checklist_item_id: string
          client_id: string
          reported_at: string | null
          state: Database["public"]["Enums"]["checklist_state"]
          verified_at: string | null
          verified_by_run_id: string | null
          verifying_at: string | null
        }
        Insert: {
          checklist_item_id: string
          client_id: string
          reported_at?: string | null
          state?: Database["public"]["Enums"]["checklist_state"]
          verified_at?: string | null
          verified_by_run_id?: string | null
          verifying_at?: string | null
        }
        Update: {
          checklist_item_id?: string
          client_id?: string
          reported_at?: string | null
          state?: Database["public"]["Enums"]["checklist_state"]
          verified_at?: string | null
          verified_by_run_id?: string | null
          verifying_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_state_item_client_fk"
            columns: ["checklist_item_id", "client_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "checklist_item_state_run_client_fk"
            columns: ["verified_by_run_id", "client_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          blocking: boolean
          client_id: string
          created_at: string
          id: string
          parent_item_id: string | null
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          blocking?: boolean
          client_id: string
          created_at?: string
          id?: string
          parent_item_id?: string | null
          sort_order: number
          template_id: string
          title: string
        }
        Update: {
          blocking?: boolean
          client_id?: string
          created_at?: string
          id?: string
          parent_item_id?: string | null
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_parent_client_fk"
            columns: ["parent_item_id", "client_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          blocking: boolean
          id: string
          key: string
          kind: Database["public"]["Enums"]["checklist_kind"]
          sort_order: number
          title: string
        }
        Insert: {
          blocking?: boolean
          id?: string
          key: string
          kind: Database["public"]["Enums"]["checklist_kind"]
          sort_order: number
          title: string
        }
        Update: {
          blocking?: boolean
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["checklist_kind"]
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          affiliate_id: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          business_name: string | null
          consumer_profile_id: string | null
          created_at: string
          display_name: string
          funded_amount_cents: number
          goal_cents: number | null
          id: string
          last_activity_at: string
          matches_unlocked_override: boolean
          org_id: string
          stage: Database["public"]["Enums"]["client_stage"]
          stage_entered_at: string
          started_at: string
          status: Database["public"]["Enums"]["client_status"]
        }
        Insert: {
          affiliate_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          business_name?: string | null
          consumer_profile_id?: string | null
          created_at?: string
          display_name: string
          funded_amount_cents?: number
          goal_cents?: number | null
          id?: string
          last_activity_at?: string
          matches_unlocked_override?: boolean
          org_id: string
          stage?: Database["public"]["Enums"]["client_stage"]
          stage_entered_at?: string
          started_at?: string
          status?: Database["public"]["Enums"]["client_status"]
        }
        Update: {
          affiliate_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          assigned_to?: string | null
          business_name?: string | null
          consumer_profile_id?: string | null
          created_at?: string
          display_name?: string
          funded_amount_cents?: number
          goal_cents?: number | null
          id?: string
          last_activity_at?: string
          matches_unlocked_override?: boolean
          org_id?: string
          stage?: Database["public"]["Enums"]["client_stage"]
          stage_entered_at?: string
          started_at?: string
          status?: Database["public"]["Enums"]["client_status"]
        }
        Relationships: [
          {
            foreignKeyName: "clients_affiliate_org_fk"
            columns: ["affiliate_id", "org_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_assignee_org_fk"
            columns: ["assigned_to", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_consumer_org_fk"
            columns: ["consumer_profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_revocations: {
        Row: {
          client_id: string
          consent_id: string
          id: string
          kind: string
          reason: string | null
          revoked_at: string
          revoked_by: string | null
        }
        Insert: {
          client_id: string
          consent_id: string
          id?: string
          kind: string
          reason?: string | null
          revoked_at?: string
          revoked_by?: string | null
        }
        Update: {
          client_id?: string
          consent_id?: string
          id?: string
          kind?: string
          reason?: string | null
          revoked_at?: string
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_revocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_revocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_revocations_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_revocations_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          action: Database["public"]["Enums"]["consent_action"]
          client_id: string
          created_at: string
          esig_ref: string
          id: string
          ip: unknown
          kind: Database["public"]["Enums"]["consent_kind"]
          signed_at: string
          supersedes_consent_id: string | null
          text_version: string
        }
        Insert: {
          action?: Database["public"]["Enums"]["consent_action"]
          client_id: string
          created_at?: string
          esig_ref: string
          id?: string
          ip: unknown
          kind: Database["public"]["Enums"]["consent_kind"]
          signed_at: string
          supersedes_consent_id?: string | null
          text_version: string
        }
        Update: {
          action?: Database["public"]["Enums"]["consent_action"]
          client_id?: string
          created_at?: string
          esig_ref?: string
          id?: string
          ip?: unknown
          kind?: Database["public"]["Enums"]["consent_kind"]
          signed_at?: string
          supersedes_consent_id?: string | null
          text_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_supersedes_consent_id_fkey"
            columns: ["supersedes_consent_id"]
            isOneToOne: false
            referencedRelation: "consents"
            referencedColumns: ["id"]
          },
        ]
      }
      crs_alert_pointers: {
        Row: {
          alert_id_ciphertext: string | null
          alert_id_iv: string | null
          alert_id_tag: string | null
          alert_reported_at: string
          client_id: string
          delivered_at: string | null
          expired_at: string | null
          expires_at: string
          id: string
          key_version: number
          monitoring_event_id: string
          occurred_at: string
          provider_alert_key: string
          provider_hook_key: string
          read_at: string | null
          received_at: string
        }
        Insert: {
          alert_id_ciphertext?: string | null
          alert_id_iv?: string | null
          alert_id_tag?: string | null
          alert_reported_at: string
          client_id: string
          delivered_at?: string | null
          expired_at?: string | null
          expires_at: string
          id?: string
          key_version: number
          monitoring_event_id: string
          occurred_at: string
          provider_alert_key: string
          provider_hook_key: string
          read_at?: string | null
          received_at: string
        }
        Update: {
          alert_id_ciphertext?: string | null
          alert_id_iv?: string | null
          alert_id_tag?: string | null
          alert_reported_at?: string
          client_id?: string
          delivered_at?: string | null
          expired_at?: string | null
          expires_at?: string
          id?: string
          key_version?: number
          monitoring_event_id?: string
          occurred_at?: string
          provider_alert_key?: string
          provider_hook_key?: string
          read_at?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crs_alert_pointers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crs_alert_pointers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crs_alert_pointers_monitoring_event_id_fkey"
            columns: ["monitoring_event_id"]
            isOneToOne: true
            referencedRelation: "monitoring_events"
            referencedColumns: ["id"]
          },
        ]
      }
      consumer_referrals: {
        Row: {
          clicked_at: string | null
          consumer_id: string
          converted_at: string | null
          converted_client_id: string | null
          created_at: string
          id: string
          platform_org_id: string
          source_client_id: string
          source_org_id: string
          token_hash: string
        }
        Insert: {
          clicked_at?: string | null
          consumer_id: string
          converted_at?: string | null
          converted_client_id?: string | null
          created_at?: string
          id?: string
          platform_org_id: string
          source_client_id: string
          source_org_id: string
          token_hash: string
        }
        Update: {
          clicked_at?: string | null
          consumer_id?: string
          converted_at?: string | null
          converted_client_id?: string | null
          created_at?: string
          id?: string
          platform_org_id?: string
          source_client_id?: string
          source_org_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumer_referrals_consumer_id_fkey"
            columns: ["consumer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_referrals_converted_client_fk"
            columns: ["converted_client_id", "platform_org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "consumer_referrals_converted_client_fk"
            columns: ["converted_client_id", "platform_org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "consumer_referrals_platform_org_id_fkey"
            columns: ["platform_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_referrals_platform_org_id_fkey"
            columns: ["platform_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_referrals_source_client_fk"
            columns: ["source_client_id", "source_org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "consumer_referrals_source_client_fk"
            columns: ["source_client_id", "source_org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "consumer_referrals_source_org_id_fkey"
            columns: ["source_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_referrals_source_org_id_fkey"
            columns: ["source_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      consumer_subscriptions: {
        Row: {
          activated_at: string | null
          attempt_provider_amount_cents: number | null
          attempt_provider_currency: string | null
          attempt_provider_returned_at: string | null
          attempt_provider_status: string | null
          attempt_provider_subscription_ref: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          currency: string
          customer_ref: string
          enrollment_id: string
          id: string
          idempotency_key: string
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          last_provider_status: string | null
          operation_id: string | null
          operation_started_at: string | null
          operation_state: string
          payment_method_ref: string | null
          price_cents: number
          price_ref: string | null
          provider: string
          provider_amount_cents: number | null
          provider_cancel_completed_at: string | null
          provider_cancel_reason: string | null
          provider_cancel_ref: string | null
          provider_cancel_requested_at: string | null
          provider_currency: string | null
          provider_status: string | null
          review_code: string | null
          setup_intent_ref: string | null
          status: string
          subscription_attempt_at: string | null
          subscription_ref: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          attempt_provider_amount_cents?: number | null
          attempt_provider_currency?: string | null
          attempt_provider_returned_at?: string | null
          attempt_provider_status?: string | null
          attempt_provider_subscription_ref?: string | null
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          currency?: string
          customer_ref: string
          enrollment_id: string
          id?: string
          idempotency_key: string
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          last_provider_status?: string | null
          operation_id?: string | null
          operation_started_at?: string | null
          operation_state?: string
          payment_method_ref?: string | null
          price_cents: number
          price_ref?: string | null
          provider: string
          provider_amount_cents?: number | null
          provider_cancel_completed_at?: string | null
          provider_cancel_reason?: string | null
          provider_cancel_ref?: string | null
          provider_cancel_requested_at?: string | null
          provider_currency?: string | null
          provider_status?: string | null
          review_code?: string | null
          setup_intent_ref?: string | null
          status?: string
          subscription_attempt_at?: string | null
          subscription_ref?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          attempt_provider_amount_cents?: number | null
          attempt_provider_currency?: string | null
          attempt_provider_returned_at?: string | null
          attempt_provider_status?: string | null
          attempt_provider_subscription_ref?: string | null
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          customer_ref?: string
          enrollment_id?: string
          id?: string
          idempotency_key?: string
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          last_provider_status?: string | null
          operation_id?: string | null
          operation_started_at?: string | null
          operation_state?: string
          payment_method_ref?: string | null
          price_cents?: number
          price_ref?: string | null
          provider?: string
          provider_amount_cents?: number | null
          provider_cancel_completed_at?: string | null
          provider_cancel_reason?: string | null
          provider_cancel_ref?: string | null
          provider_cancel_requested_at?: string | null
          provider_currency?: string | null
          provider_status?: string | null
          review_code?: string | null
          setup_intent_ref?: string | null
          status?: string
          subscription_attempt_at?: string | null
          subscription_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumer_subscriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_subscriptions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumer_subscriptions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_uploads: {
        Row: {
          bucket: string
          client_id: string
          created_at: string
          derived_features: Json | null
          display_name: string
          failure_code: string | null
          id: string
          kind: Database["public"]["Enums"]["document_upload_kind"]
          lifecycle: Database["public"]["Enums"]["document_upload_lifecycle"]
          mime_type: string
          object_path: string
          org_id: string
          purged_at: string | null
          section: Database["public"]["Enums"]["document_section"] | null
          size_bytes: number
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          bucket: string
          client_id: string
          created_at?: string
          derived_features?: Json | null
          display_name: string
          failure_code?: string | null
          id?: string
          kind: Database["public"]["Enums"]["document_upload_kind"]
          lifecycle?: Database["public"]["Enums"]["document_upload_lifecycle"]
          mime_type: string
          object_path: string
          org_id: string
          purged_at?: string | null
          section?: Database["public"]["Enums"]["document_section"] | null
          size_bytes: number
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          bucket?: string
          client_id?: string
          created_at?: string
          derived_features?: Json | null
          display_name?: string
          failure_code?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["document_upload_kind"]
          lifecycle?: Database["public"]["Enums"]["document_upload_lifecycle"]
          mime_type?: string
          object_path?: string
          org_id?: string
          purged_at?: string | null
          section?: Database["public"]["Enums"]["document_section"] | null
          size_bytes?: number
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_uploads_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_uploads_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "document_uploads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          accepted_at: string | null
          attempt_count: number
          created_at: string
          delivery_id: string
          error_code: string | null
          id: string
          org_id: string
          provider_ref: string | null
          recipient_hash: string
          status: Database["public"]["Enums"]["email_outbox_status"]
          template: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempt_count?: number
          created_at?: string
          delivery_id: string
          error_code?: string | null
          id?: string
          org_id: string
          provider_ref?: string | null
          recipient_hash: string
          status?: Database["public"]["Enums"]["email_outbox_status"]
          template: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempt_count?: number
          created_at?: string
          delivery_id?: string
          error_code?: string | null
          id?: string
          org_id?: string
          provider_ref?: string | null
          recipient_hash?: string
          status?: Database["public"]["Enums"]["email_outbox_status"]
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "notification_delivery_dispatch_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "notification_delivery_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_milestones: {
        Row: {
          client_id: string
          completed_at: string | null
          completed_by: string | null
          kind: Database["public"]["Enums"]["enrollment_milestone_kind"]
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          kind: Database["public"]["Enums"]["enrollment_milestone_kind"]
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          kind?: Database["public"]["Enums"]["enrollment_milestone_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_milestones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_milestones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          analysis_consent_at: string
          client_id: string
          created_at: string
          crs_member_ref: string | null
          esig_doc_id: string
          id: string
          idpass: boolean
          monitoring_consent_at: string
          parked_until: string | null
          persona_hint: Database["public"]["Enums"]["crs_persona"] | null
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          analysis_consent_at: string
          client_id: string
          created_at?: string
          crs_member_ref?: string | null
          esig_doc_id: string
          id?: string
          idpass?: boolean
          monitoring_consent_at: string
          parked_until?: string | null
          persona_hint?: Database["public"]["Enums"]["crs_persona"] | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          analysis_consent_at?: string
          client_id?: string
          created_at?: string
          crs_member_ref?: string | null
          esig_doc_id?: string
          id?: string
          idpass?: boolean
          monitoring_consent_at?: string
          parked_until?: string | null
          persona_hint?: Database["public"]["Enums"]["crs_persona"] | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      esignatures: {
        Row: {
          client_draft_id: string
          client_id: string
          created_at: string
          document_kind: string
          id: string
          ip: unknown
          signed_at: string
          signer_name: string
          text_version: string
          typed_signature: string
          user_agent: string | null
        }
        Insert: {
          client_draft_id: string
          client_id: string
          created_at?: string
          document_kind: string
          id?: string
          ip?: unknown
          signed_at?: string
          signer_name: string
          text_version: string
          typed_signature: string
          user_agent?: string | null
        }
        Update: {
          client_draft_id?: string
          client_id?: string
          created_at?: string
          document_kind?: string
          id?: string
          ip?: unknown
          signed_at?: string
          signer_name?: string
          text_version?: string
          typed_signature?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esignatures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esignatures_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          driver: string
          eligible: boolean
          evaluator_key: string
          id: string
          model: string
          passed: boolean
          policy_version: string
          prompt_key: string
          prompt_version: number
          ran_at: string
          ran_by: string | null
          reference_dataset_hash: string
          result: Json
        }
        Insert: {
          driver?: string
          eligible?: boolean
          evaluator_key: string
          id?: string
          model?: string
          passed: boolean
          policy_version: string
          prompt_key: string
          prompt_version: number
          ran_at?: string
          ran_by?: string | null
          reference_dataset_hash?: string
          result: Json
        }
        Update: {
          driver?: string
          eligible?: boolean
          evaluator_key?: string
          id?: string
          model?: string
          passed?: boolean
          policy_version?: string
          prompt_key?: string
          prompt_version?: number
          ran_at?: string
          ran_by?: string | null
          reference_dataset_hash?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_ran_by_fkey"
            columns: ["ran_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_agreements: {
        Row: {
          client_id: string
          created_at: string
          custom_total_cents: number | null
          id: string
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct: number | null
          source: string
          status: Database["public"]["Enums"]["fee_agreement_status"]
          success_cents: number | null
          trigger_cents: number | null
          updated_at: string
          upfront_cents: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          custom_total_cents?: number | null
          id?: string
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct?: number | null
          source: string
          status?: Database["public"]["Enums"]["fee_agreement_status"]
          success_cents?: number | null
          trigger_cents?: number | null
          updated_at?: string
          upfront_cents?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          custom_total_cents?: number | null
          id?: string
          model?: Database["public"]["Enums"]["fee_model"]
          org_id?: string
          pct?: number | null
          source?: string
          status?: Database["public"]["Enums"]["fee_agreement_status"]
          success_cents?: number | null
          trigger_cents?: number | null
          updated_at?: string
          upfront_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_agreements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_agreements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_agreements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_ledger: {
        Row: {
          balance_cents: number | null
          client_id: string
          org_id: string
          outcome_basis_cents: number
          outcome_basis_source: string | null
          paid_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          balance_cents?: number | null
          client_id: string
          org_id: string
          outcome_basis_cents?: number
          outcome_basis_source?: string | null
          paid_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          balance_cents?: number | null
          client_id?: string
          org_id?: string
          outcome_basis_cents?: number
          outcome_basis_source?: string | null
          paid_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_ledger_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_ledger_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_payments: {
        Row: {
          amount_cents: number
          client_id: string
          id: string
          method: Database["public"]["Enums"]["fee_payment_method"]
          note: string | null
          org_id: string
          received_on: string
          recorded_at: string
          recorded_by: string
          reference: string | null
          reversed_at: string | null
          reversed_by: string | null
        }
        Insert: {
          amount_cents: number
          client_id: string
          id?: string
          method: Database["public"]["Enums"]["fee_payment_method"]
          note?: string | null
          org_id: string
          received_on: string
          recorded_at?: string
          recorded_by: string
          reference?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
        }
        Update: {
          amount_cents?: number
          client_id?: string
          id?: string
          method?: Database["public"]["Enums"]["fee_payment_method"]
          note?: string | null
          org_id?: string
          received_on?: string
          recorded_at?: string
          recorded_by?: string
          reference?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fee_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payments_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      held_drafts: {
        Row: {
          body: string
          confidence: number
          confidence_threshold: number
          created_at: string
          discarded_at: string | null
          discarded_by: string | null
          driver: string
          guardrail_flags: string[]
          id: string
          model: string
          prompt_key: string
          prompt_version: number
          sent_at: string | null
          sent_by: string | null
          sent_message_id: string | null
          status: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved: boolean
          thread_id: string
        }
        Insert: {
          body: string
          confidence: number
          confidence_threshold: number
          created_at?: string
          discarded_at?: string | null
          discarded_by?: string | null
          driver: string
          guardrail_flags?: string[]
          id?: string
          model: string
          prompt_key: string
          prompt_version: number
          sent_at?: string | null
          sent_by?: string | null
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved: boolean
          thread_id: string
        }
        Update: {
          body?: string
          confidence?: number
          confidence_threshold?: number
          created_at?: string
          discarded_at?: string | null
          discarded_by?: string | null
          driver?: string
          guardrail_flags?: string[]
          id?: string
          model?: string
          prompt_key?: string
          prompt_version?: number
          sent_at?: string | null
          sent_by?: string | null
          sent_message_id?: string | null
          status?: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved?: boolean
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_drafts_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_drafts_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_drafts_sent_message_fk"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "support_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_drafts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      idv_sessions: {
        Row: {
          attempts_used: number
          client_id: string
          created_at: string
          driver: string
          enrollment_id: string
          expires_at: string | null
          id: string
          kind: string
          locked_until: string | null
          max_attempts: number
          member_ref: string | null
          outcome: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts_used?: number
          client_id: string
          created_at?: string
          driver: string
          enrollment_id: string
          expires_at?: string | null
          id?: string
          kind?: string
          locked_until?: string | null
          max_attempts: number
          member_ref?: string | null
          outcome?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts_used?: number
          client_id?: string
          created_at?: string
          driver?: string
          enrollment_id?: string
          expires_at?: string | null
          id?: string
          kind?: string
          locked_until?: string | null
          max_attempts?: number
          member_ref?: string | null
          outcome?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "idv_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "idv_sessions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_affiliate_id: string | null
          accepted_at: string | null
          accepted_profile_id: string | null
          created_at: string
          created_by: string
          email: string
          expires_at: string
          failure_code: string | null
          full_name: string
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["tenant_invite_kind"]
          org_id: string
          org_role: Database["public"]["Enums"]["org_role"] | null
          provider_user_id: string | null
          status: Database["public"]["Enums"]["tenant_invite_status"]
          token_id: string
          updated_at: string
        }
        Insert: {
          accepted_affiliate_id?: string | null
          accepted_at?: string | null
          accepted_profile_id?: string | null
          created_at?: string
          created_by: string
          email: string
          expires_at: string
          failure_code?: string | null
          full_name: string
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["tenant_invite_kind"]
          org_id: string
          org_role?: Database["public"]["Enums"]["org_role"] | null
          provider_user_id?: string | null
          status?: Database["public"]["Enums"]["tenant_invite_status"]
          token_id?: string
          updated_at?: string
        }
        Update: {
          accepted_affiliate_id?: string | null
          accepted_at?: string | null
          accepted_profile_id?: string | null
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          failure_code?: string | null
          full_name?: string
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["tenant_invite_kind"]
          org_id?: string
          org_role?: Database["public"]["Enums"]["org_role"] | null
          provider_user_id?: string | null
          status?: Database["public"]["Enums"]["tenant_invite_status"]
          token_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_affiliate_id_fkey"
            columns: ["accepted_affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_accepted_profile_id_fkey"
            columns: ["accepted_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          body: string
          embedded_at: string
          embedding: number[]
          embedding_version: string
          first_imported_at: string
          id: string
          last_imported_at: string
          metadata: Json
          source_article_id: string
          source_checksum: string
          source_updated_at: string | null
          source_url: string
          title: string
          tombstoned_at: string | null
        }
        Insert: {
          body: string
          embedded_at: string
          embedding: number[]
          embedding_version: string
          first_imported_at?: string
          id?: string
          last_imported_at?: string
          metadata?: Json
          source_article_id: string
          source_checksum: string
          source_updated_at?: string | null
          source_url: string
          title: string
          tombstoned_at?: string | null
        }
        Update: {
          body?: string
          embedded_at?: string
          embedding?: number[]
          embedding_version?: string
          first_imported_at?: string
          id?: string
          last_imported_at?: string
          metadata?: Json
          source_article_id?: string
          source_checksum?: string
          source_updated_at?: string | null
          source_url?: string
          title?: string
          tombstoned_at?: string | null
        }
        Relationships: []
      }
      kb_import_runs: {
        Row: {
          added_count: number
          changed_count: number
          completed_at: string | null
          cursor: string | null
          driver: string
          embedded_count: number
          error_code: string | null
          id: string
          idempotency_key: string | null
          restored_count: number
          source_count: number
          started_at: string
          status: Database["public"]["Enums"]["kb_import_status"]
          subject: string
          tombstoned_count: number
          unchanged_count: number
          updated_at: string
          window: string
        }
        Insert: {
          added_count?: number
          changed_count?: number
          completed_at?: string | null
          cursor?: string | null
          driver: string
          embedded_count?: number
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          restored_count?: number
          source_count?: number
          started_at?: string
          status?: Database["public"]["Enums"]["kb_import_status"]
          subject: string
          tombstoned_count?: number
          unchanged_count?: number
          updated_at?: string
          window: string
        }
        Update: {
          added_count?: number
          changed_count?: number
          completed_at?: string | null
          cursor?: string | null
          driver?: string
          embedded_count?: number
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          restored_count?: number
          source_count?: number
          started_at?: string
          status?: Database["public"]["Enums"]["kb_import_status"]
          subject?: string
          tombstoned_count?: number
          unchanged_count?: number
          updated_at?: string
          window?: string
        }
        Relationships: []
      }
      kb_import_seen: {
        Row: {
          run_id: string
          seen_at: string
          source_article_id: string
          source_checksum: string
        }
        Insert: {
          run_id: string
          seen_at?: string
          source_article_id: string
          source_checksum: string
        }
        Update: {
          run_id?: string
          seen_at?: string
          source_article_id?: string
          source_checksum?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_import_seen_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "kb_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_rollups: {
        Row: {
          day: string
          metrics: Json
          scope: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          day: string
          metrics: Json
          scope: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          day?: string
          metrics?: Json
          scope?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      monitoring_events: {
        Row: {
          client_id: string
          event_type: string
          id: string
          occurred_at: string
          received_at: string
        }
        Insert: {
          client_id: string
          event_type: string
          id?: string
          occurred_at: string
          received_at?: string
        }
        Update: {
          client_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitoring_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_outbox: {
        Row: {
          attempt_count: number
          available_at: string
          billing_event_id: string | null
          channel: Database["public"]["Enums"]["notification_delivery_channel"]
          client_id: string | null
          created_at: string
          delivered_at: string | null
          dispatch_subject: string | null
          dispatch_window: string | null
          email_template: string | null
          error_code: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          notification_id: string | null
          org_id: string | null
          status: Database["public"]["Enums"]["notification_delivery_status"]
          subject: string | null
          updated_at: string
          window: string | null
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          billing_event_id?: string | null
          channel?: Database["public"]["Enums"]["notification_delivery_channel"]
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dispatch_subject?: string | null
          dispatch_window?: string | null
          email_template?: string | null
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          notification_id?: string | null
          org_id?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          subject?: string | null
          updated_at?: string
          window?: string | null
        }
        Update: {
          attempt_count?: number
          available_at?: string
          billing_event_id?: string | null
          channel?: Database["public"]["Enums"]["notification_delivery_channel"]
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          dispatch_subject?: string | null
          dispatch_window?: string | null
          email_template?: string | null
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          notification_id?: string | null
          org_id?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          subject?: string | null
          updated_at?: string
          window?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_outbox_billing_event_id_fkey"
            columns: ["billing_event_id"]
            isOneToOne: false
            referencedRelation: "operator_billing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "outcome_notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_billing_events: {
        Row: {
          applied: boolean
          event_id: string
          event_type: string
          from_membership: Database["public"]["Enums"]["org_membership"] | null
          from_status:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
          id: string
          occurred_at: string
          org_id: string
          reason_code: string
          recorded_at: string
          to_membership: Database["public"]["Enums"]["org_membership"] | null
          to_status:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
        }
        Insert: {
          applied: boolean
          event_id: string
          event_type: string
          from_membership?: Database["public"]["Enums"]["org_membership"] | null
          from_status?:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
          id?: string
          occurred_at: string
          org_id: string
          reason_code: string
          recorded_at?: string
          to_membership?: Database["public"]["Enums"]["org_membership"] | null
          to_status?:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
        }
        Update: {
          applied?: boolean
          event_id?: string
          event_type?: string
          from_membership?: Database["public"]["Enums"]["org_membership"] | null
          from_status?:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
          id?: string
          occurred_at?: string
          org_id?: string
          reason_code?: string
          recorded_at?: string
          to_membership?: Database["public"]["Enums"]["org_membership"] | null
          to_status?:
            | Database["public"]["Enums"]["operator_subscription_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_billing_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_billing_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_earnings_ledger: {
        Row: {
          accrual_month: string
          amount_cents: number | null
          base_amount_cents: number
          created_at: string
          id: string
          incomplete_code: string | null
          is_complete: boolean
          operator_org_id: string
          pct_snapshot: number | null
          settlement_status: Database["public"]["Enums"]["settlement_status"]
          source_row_count: number
        }
        Insert: {
          accrual_month: string
          amount_cents?: number | null
          base_amount_cents?: number
          created_at?: string
          id?: string
          incomplete_code?: string | null
          is_complete?: boolean
          operator_org_id: string
          pct_snapshot?: number | null
          settlement_status?: Database["public"]["Enums"]["settlement_status"]
          source_row_count?: number
        }
        Update: {
          accrual_month?: string
          amount_cents?: number | null
          base_amount_cents?: number
          created_at?: string
          id?: string
          incomplete_code?: string | null
          is_complete?: boolean
          operator_org_id?: string
          pct_snapshot?: number | null
          settlement_status?: Database["public"]["Enums"]["settlement_status"]
          source_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "operator_earnings_ledger_operator_org_id_fkey"
            columns: ["operator_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_earnings_ledger_operator_org_id_fkey"
            columns: ["operator_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_seat_sync_outbox: {
        Row: {
          attempts: number
          desired_quantity: number
          enqueued_at: string
          generation: string
          last_error_code: string | null
          org_id: string
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          desired_quantity: number
          enqueued_at?: string
          generation?: string
          last_error_code?: string | null
          org_id: string
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          desired_quantity?: number
          enqueued_at?: string
          generation?: string
          last_error_code?: string | null
          org_id?: string
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_seat_sync_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_seat_sync_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_subscription_creation_intents: {
        Row: {
          completed_at: string | null
          created_at: string
          creation_path: string
          operation_id: string
          org_id: string
          provider_ref: string | null
          review_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          creation_path: string
          operation_id?: string
          org_id: string
          provider_ref?: string | null
          review_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          creation_path?: string
          operation_id?: string
          org_id?: string
          provider_ref?: string | null
          review_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_subscription_creation_intents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_subscription_creation_intents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_subscriptions: {
        Row: {
          base_item_ref: string | null
          base_price_ref: string
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          customer_ref: string | null
          grace_started_at: string | null
          grace_until: string | null
          id: string
          last_event_at: string | null
          last_event_id: string | null
          org_id: string
          provider: string
          seat_item_ref: string | null
          seat_price_ref: string
          seat_quantity: number
          status: Database["public"]["Enums"]["operator_subscription_status"]
          subscription_ref: string | null
          updated_at: string
        }
        Insert: {
          base_item_ref?: string | null
          base_price_ref: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          customer_ref?: string | null
          grace_started_at?: string | null
          grace_until?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          org_id: string
          provider?: string
          seat_item_ref?: string | null
          seat_price_ref: string
          seat_quantity?: number
          status?: Database["public"]["Enums"]["operator_subscription_status"]
          subscription_ref?: string | null
          updated_at?: string
        }
        Update: {
          base_item_ref?: string | null
          base_price_ref?: string
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          customer_ref?: string | null
          grace_started_at?: string | null
          grace_until?: string | null
          id?: string
          last_event_at?: string | null
          last_event_id?: string | null
          org_id?: string
          provider?: string
          seat_item_ref?: string | null
          seat_price_ref?: string
          seat_quantity?: number
          status?: Database["public"]["Enums"]["operator_subscription_status"]
          subscription_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_fee_defaults: {
        Row: {
          custom_total_cents: number | null
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct: number | null
          success_cents: number | null
          trigger_cents: number | null
          updated_at: string
          updated_by: string
          upfront_cents: number | null
        }
        Insert: {
          custom_total_cents?: number | null
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct?: number | null
          success_cents?: number | null
          trigger_cents?: number | null
          updated_at?: string
          updated_by: string
          upfront_cents?: number | null
        }
        Update: {
          custom_total_cents?: number | null
          model?: Database["public"]["Enums"]["fee_model"]
          org_id?: string
          pct?: number | null
          success_cents?: number | null
          trigger_cents?: number | null
          updated_at?: string
          updated_by?: string
          upfront_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "org_fee_defaults_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_fee_defaults_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_fee_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_flags: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          legal_signoff_ref: string | null
          org_id: string
          updated_at: string
          upfront_fee_approved: boolean
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          legal_signoff_ref?: string | null
          org_id: string
          updated_at?: string
          upfront_fee_approved?: boolean
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          legal_signoff_ref?: string | null
          org_id?: string
          updated_at?: string
          upfront_fee_approved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "org_flags_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_flags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_flags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          assignment_mode: Database["public"]["Enums"]["assignment_mode"]
          base_price_cents: number
          brand: Json
          brand_published_at: string | null
          client_cap: number | null
          created_at: string
          default_client_goal_cents: number
          id: string
          membership: Database["public"]["Enums"]["org_membership"]
          monitoring_split_pct: number | null
          name: string
          notification_client_messages: boolean
          notification_digest_enabled: boolean
          notification_digest_frequency: string
          notification_email_holds: boolean
          notification_payment_failed: boolean
          notification_task_due: boolean
          payouts_enabled: boolean | null
          plan: Database["public"]["Enums"]["org_plan"]
          portal_allow_document_uploads: boolean
          portal_application_visibility: string
          portal_show_funding_progress: boolean
          portal_show_trainings: boolean
          seat_price_cents: number
          seats_included: number
          slug: string
          stripe_account_id: string | null
          team_sees_all_clients: boolean
          trial_ends_at: string | null
        }
        Insert: {
          assignment_mode?: Database["public"]["Enums"]["assignment_mode"]
          base_price_cents?: number
          brand?: Json
          brand_published_at?: string | null
          client_cap?: number | null
          created_at?: string
          default_client_goal_cents?: number
          id?: string
          membership?: Database["public"]["Enums"]["org_membership"]
          monitoring_split_pct?: number | null
          name: string
          notification_client_messages?: boolean
          notification_digest_enabled?: boolean
          notification_digest_frequency?: string
          notification_email_holds?: boolean
          notification_payment_failed?: boolean
          notification_task_due?: boolean
          payouts_enabled?: boolean | null
          plan?: Database["public"]["Enums"]["org_plan"]
          portal_allow_document_uploads?: boolean
          portal_application_visibility?: string
          portal_show_funding_progress?: boolean
          portal_show_trainings?: boolean
          seat_price_cents?: number
          seats_included?: number
          slug: string
          stripe_account_id?: string | null
          team_sees_all_clients?: boolean
          trial_ends_at?: string | null
        }
        Update: {
          assignment_mode?: Database["public"]["Enums"]["assignment_mode"]
          base_price_cents?: number
          brand?: Json
          brand_published_at?: string | null
          client_cap?: number | null
          created_at?: string
          default_client_goal_cents?: number
          id?: string
          membership?: Database["public"]["Enums"]["org_membership"]
          monitoring_split_pct?: number | null
          name?: string
          notification_client_messages?: boolean
          notification_digest_enabled?: boolean
          notification_digest_frequency?: string
          notification_email_holds?: boolean
          notification_payment_failed?: boolean
          notification_task_due?: boolean
          payouts_enabled?: boolean | null
          plan?: Database["public"]["Enums"]["org_plan"]
          portal_allow_document_uploads?: boolean
          portal_application_visibility?: string
          portal_show_funding_progress?: boolean
          portal_show_trainings?: boolean
          seat_price_cents?: number
          seats_included?: number
          slug?: string
          stripe_account_id?: string | null
          team_sees_all_clients?: boolean
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      outcome_notifications: {
        Row: {
          client_id: string | null
          created_at: string
          delivered_at: string | null
          id: string
          kind: Database["public"]["Enums"]["outcome_notification_kind"]
          monitoring_event_id: string | null
          org_id: string
          outcome_id: string | null
          read_at: string | null
          recipient_profile_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["outcome_notification_kind"]
          monitoring_event_id?: string | null
          org_id: string
          outcome_id?: string | null
          read_at?: string | null
          recipient_profile_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["outcome_notification_kind"]
          monitoring_event_id?: string | null
          org_id?: string
          outcome_id?: string | null
          read_at?: string | null
          recipient_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outcome_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_monitoring_event_id_fkey"
            columns: ["monitoring_event_id"]
            isOneToOne: false
            referencedRelation: "monitoring_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_notifications_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_refresh_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          bank_ref: string
          change_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          status: Database["public"]["Enums"]["outcome_job_status"]
          subject: string | null
          updated_at: string
          window: string | null
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          bank_ref: string
          change_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          status?: Database["public"]["Enums"]["outcome_job_status"]
          subject?: string | null
          updated_at?: string
          window?: string | null
        }
        Update: {
          attempt_count?: number
          available_at?: string
          bank_ref?: string
          change_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          job?: string
          lease_owner?: string | null
          lease_until?: string | null
          status?: Database["public"]["Enums"]["outcome_job_status"]
          subject?: string | null
          updated_at?: string
          window?: string | null
        }
        Relationships: []
      }
      outcome_reviews: {
        Row: {
          created_at: string
          id: string
          outcome_id: string
          reason_code: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: Database["public"]["Enums"]["outcome_review_state"]
        }
        Insert: {
          created_at?: string
          id?: string
          outcome_id: string
          reason_code?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["outcome_review_state"]
        }
        Update: {
          created_at?: string
          id?: string
          outcome_id?: string
          reason_code?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: Database["public"]["Enums"]["outcome_review_state"]
        }
        Relationships: [
          {
            foreignKeyName: "outcome_reviews_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: true
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outcomes: {
        Row: {
          amount_cents: number | null
          application_id: string
          bank_ref: string
          client_id: string
          created_at: string
          decided_on: string
          id: string
          kind: Database["public"]["Enums"]["outcome_kind"]
          recorded_by: string | null
          recorded_by_kind: Database["public"]["Enums"]["application_note_author_kind"]
          removed_at: string | null
          removed_by: string | null
          state: Database["public"]["Enums"]["outcome_state"]
        }
        Insert: {
          amount_cents?: number | null
          application_id: string
          bank_ref: string
          client_id: string
          created_at?: string
          decided_on?: string
          id?: string
          kind: Database["public"]["Enums"]["outcome_kind"]
          recorded_by?: string | null
          recorded_by_kind: Database["public"]["Enums"]["application_note_author_kind"]
          removed_at?: string | null
          removed_by?: string | null
          state?: Database["public"]["Enums"]["outcome_state"]
        }
        Update: {
          amount_cents?: number | null
          application_id?: string
          bank_ref?: string
          client_id?: string
          created_at?: string
          decided_on?: string
          id?: string
          kind?: Database["public"]["Enums"]["outcome_kind"]
          recorded_by?: string | null
          recorded_by_kind?: Database["public"]["Enums"]["application_note_author_kind"]
          removed_at?: string | null
          removed_by?: string | null
          state?: Database["public"]["Enums"]["outcome_state"]
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_application_bank_fk"
            columns: ["application_id", "bank_ref"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id", "bank_ref"]
          },
          {
            foreignKeyName: "outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcomes_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_refresh_payment_events: {
        Row: {
          amount_cents: number
          currency: string
          id: string
          occurred_at: string
          outcome: string
          provider_event_key: string
          provider_payment_ref: string
          request_id: string
        }
        Insert: {
          amount_cents: number
          currency: string
          id?: string
          occurred_at?: string
          outcome: string
          provider_event_key: string
          provider_payment_ref: string
          request_id: string
        }
        Update: {
          amount_cents?: number
          currency?: string
          id?: string
          occurred_at?: string
          outcome?: string
          provider_event_key?: string
          provider_payment_ref?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paid_refresh_payment_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "paid_refresh_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      paid_refresh_requests: {
        Row: {
          actor_profile_id: string
          amount_cents: number
          analysis_run_id: string | null
          client_id: string
          created_at: string
          currency: string
          driver: string
          id: string
          idempotency_key: string
          org_id: string
          payment_attempt_state: string
          payment_dispatch_started_at: string | null
          payment_idempotency_key: string | null
          payment_provider_event_key: string | null
          payment_provider_outcome: string | null
          payment_provider_payment_ref: string | null
          payment_provider_returned_at: string | null
          provider_payment_ref: string | null
          state: string
          updated_at: string
        }
        Insert: {
          actor_profile_id: string
          amount_cents: number
          analysis_run_id?: string | null
          client_id: string
          created_at?: string
          currency: string
          driver: string
          id?: string
          idempotency_key: string
          org_id: string
          payment_attempt_state?: string
          payment_dispatch_started_at?: string | null
          payment_idempotency_key?: string | null
          payment_provider_event_key?: string | null
          payment_provider_outcome?: string | null
          payment_provider_payment_ref?: string | null
          payment_provider_returned_at?: string | null
          provider_payment_ref?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string
          amount_cents?: number
          analysis_run_id?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          driver?: string
          id?: string
          idempotency_key?: string
          org_id?: string
          payment_attempt_state?: string
          payment_dispatch_started_at?: string | null
          payment_idempotency_key?: string | null
          payment_provider_event_key?: string | null
          payment_provider_outcome?: string | null
          payment_provider_payment_ref?: string | null
          payment_provider_returned_at?: string | null
          provider_payment_ref?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paid_refresh_requests_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_refresh_requests_analysis_run_fk"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_jobs"
            referencedColumns: ["analysis_run_id"]
          },
          {
            foreignKeyName: "paid_refresh_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_refresh_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_refresh_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paid_refresh_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          analysis_run_id: string
          body: Json
          client_id: string
          created_at: string
          id: string
          readiness_score: number
          version: number
        }
        Insert: {
          analysis_run_id: string
          body: Json
          client_id: string
          created_at?: string
          id?: string
          readiness_score: number
          version: number
        }
        Update: {
          analysis_run_id?: string
          body?: Json
          client_id?: string
          created_at?: string
          id?: string
          readiness_score?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "plans_analysis_run_client_fk"
            columns: ["analysis_run_id", "client_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          disabled_at: string | null
          email: string
          full_name: string
          id: string
          manages: string[]
          org_id: string | null
          org_role: Database["public"]["Enums"]["org_role"] | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          email: string
          full_name: string
          id: string
          manages?: string[]
          org_id?: string | null
          org_role?: Database["public"]["Enums"]["org_role"] | null
          phone?: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          email?: string
          full_name?: string
          id?: string
          manages?: string[]
          org_id?: string | null
          org_role?: Database["public"]["Enums"]["org_role"] | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          key: string
          version: number
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          created_by?: string | null
          key: string
          version: number
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          key?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pull_cap_attempts: {
        Row: {
          allowed: boolean
          cause: Database["public"]["Enums"]["analysis_trigger"]
          client_id: string
          decided_at: string
          id: string
          org_id: string
          reason: Database["public"]["Enums"]["pull_cap_reason"] | null
          reservation_expires_at: string | null
          reservation_state: string
          source_id: string
        }
        Insert: {
          allowed: boolean
          cause: Database["public"]["Enums"]["analysis_trigger"]
          client_id: string
          decided_at?: string
          id?: string
          org_id: string
          reason?: Database["public"]["Enums"]["pull_cap_reason"] | null
          reservation_expires_at?: string | null
          reservation_state?: string
          source_id: string
        }
        Update: {
          allowed?: boolean
          cause?: Database["public"]["Enums"]["analysis_trigger"]
          client_id?: string
          decided_at?: string
          id?: string
          org_id?: string
          reason?: Database["public"]["Enums"]["pull_cap_reason"] | null
          reservation_expires_at?: string | null
          reservation_state?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pull_cap_attempts_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "pull_cap_attempts_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      pull_caps: {
        Row: {
          client_id: string
          count_window_seconds: number | null
          max_count: number | null
          min_interval_seconds: number | null
          org_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          client_id: string
          count_window_seconds?: number | null
          max_count?: number | null
          min_interval_seconds?: number | null
          org_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          client_id?: string
          count_window_seconds?: number | null
          max_count?: number | null
          min_interval_seconds?: number | null
          org_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "pull_caps_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "pull_caps_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "pull_caps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_ledger: {
        Row: {
          accrual_month: string
          amount_cents: number
          base_amount_cents: number
          base_snapshot: string
          created_at: string
          cycle_number: number
          id: string
          incomplete_code: string | null
          is_complete: boolean
          pct_snapshot: number
          referred_org_id: string
          referrer_org_id: string
          saas_referral_id: string
          settlement_status: Database["public"]["Enums"]["settlement_status"]
          source_row_count: number
        }
        Insert: {
          accrual_month: string
          amount_cents?: number
          base_amount_cents?: number
          base_snapshot: string
          created_at?: string
          cycle_number: number
          id?: string
          incomplete_code?: string | null
          is_complete?: boolean
          pct_snapshot: number
          referred_org_id: string
          referrer_org_id: string
          saas_referral_id: string
          settlement_status?: Database["public"]["Enums"]["settlement_status"]
          source_row_count?: number
        }
        Update: {
          accrual_month?: string
          amount_cents?: number
          base_amount_cents?: number
          base_snapshot?: string
          created_at?: string
          cycle_number?: number
          id?: string
          incomplete_code?: string | null
          is_complete?: boolean
          pct_snapshot?: number
          referred_org_id?: string
          referrer_org_id?: string
          saas_referral_id?: string
          settlement_status?: Database["public"]["Enums"]["settlement_status"]
          source_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "referral_ledger_referred_org_id_fkey"
            columns: ["referred_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_ledger_referred_org_id_fkey"
            columns: ["referred_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_ledger_referrer_org_id_fkey"
            columns: ["referrer_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_ledger_referrer_org_id_fkey"
            columns: ["referrer_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_ledger_saas_referral_id_fkey"
            columns: ["saas_referral_id"]
            isOneToOne: false
            referencedRelation: "saas_referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_referrals: {
        Row: {
          base: string
          created_at: string
          id: string
          months: number
          payouts_enabled: boolean | null
          pct: number
          referred_org_id: string
          referrer_org_id: string
          started_at: string
          stripe_account_id: string | null
          updated_at: string
        }
        Insert: {
          base?: string
          created_at?: string
          id?: string
          months?: number
          payouts_enabled?: boolean | null
          pct?: number
          referred_org_id: string
          referrer_org_id: string
          started_at: string
          stripe_account_id?: string | null
          updated_at?: string
        }
        Update: {
          base?: string
          created_at?: string
          id?: string
          months?: number
          payouts_enabled?: boolean | null
          pct?: number
          referred_org_id?: string
          referrer_org_id?: string
          started_at?: string
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_referrals_referred_org_id_fkey"
            columns: ["referred_org_id"]
            isOneToOne: true
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_referrals_referred_org_id_fkey"
            columns: ["referred_org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_referrals_referrer_org_id_fkey"
            columns: ["referrer_org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_referrals_referrer_org_id_fkey"
            columns: ["referrer_org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          client_id: string
          from_stage: Database["public"]["Enums"]["client_stage"] | null
          id: string
          to_stage: Database["public"]["Enums"]["client_stage"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          client_id: string
          from_stage?: Database["public"]["Enums"]["client_stage"] | null
          id?: string
          to_stage: Database["public"]["Enums"]["client_stage"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          client_id?: string
          from_stage?: Database["public"]["Enums"]["client_stage"] | null
          id?: string
          to_stage?: Database["public"]["Enums"]["client_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          attempts: number
          event_id: string
          event_type: string
          last_error_code: string | null
          lease_owner: string | null
          lease_until: string | null
          processed_at: string | null
          received_at: string
          status: string
        }
        Insert: {
          attempts?: number
          event_id: string
          event_type: string
          last_error_code?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          event_id?: string
          event_type?: string
          last_error_code?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          processed_at?: string | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          author_kind: Database["public"]["Enums"]["support_author_kind"]
          author_profile_id: string
          body: string
          id: string
          origin: Database["public"]["Enums"]["support_message_origin"]
          origin_draft_id: string | null
          sent_at: string
          thread_id: string
        }
        Insert: {
          author_kind: Database["public"]["Enums"]["support_author_kind"]
          author_profile_id: string
          body: string
          id?: string
          origin?: Database["public"]["Enums"]["support_message_origin"]
          origin_draft_id?: string | null
          sent_at?: string
          thread_id: string
        }
        Update: {
          author_kind?: Database["public"]["Enums"]["support_author_kind"]
          author_profile_id?: string
          body?: string
          id?: string
          origin?: Database["public"]["Enums"]["support_message_origin"]
          origin_draft_id?: string | null
          sent_at?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_origin_draft_fk"
            columns: ["origin_draft_id"]
            isOneToOne: true
            referencedRelation: "held_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at: string
          org_id: string
          status: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at?: string
          org_id: string
          status?: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          kind?: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at?: string
          org_id?: string
          status?: Database["public"]["Enums"]["support_thread_status"]
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_threads_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "support_threads_client_org_fk"
            columns: ["client_id", "org_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "support_threads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      tracker_transition_receipts: {
        Row: {
          client_id: string
          event_key: string
          received_at: string
          source: string
        }
        Insert: {
          client_id: string
          event_key: string
          received_at?: string
          source: string
        }
        Update: {
          client_id?: string
          event_key?: string
          received_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracker_transition_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracker_transition_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "specialist_default_client_view"
            referencedColumns: ["id"]
          },
        ]
      }
      trainings: {
        Row: {
          attestation_text: string | null
          attested: boolean
          attested_at: string | null
          audience: Database["public"]["Enums"]["training_audience"]
          body: string
          created_at: string
          created_by: string
          id: string
          org_id: string | null
          published: boolean
          published_at: string | null
          published_by: string | null
          source: Database["public"]["Enums"]["training_source"]
          source_file_name: string | null
          source_mime_type: string | null
          source_object_path: string | null
          source_size_bytes: number | null
          source_uploaded_at: string | null
          takedown_reason: string | null
          taken_down_at: string | null
          taken_down_by: string | null
          title: string
          updated_at: string
          video_url: string
        }
        Insert: {
          attestation_text?: string | null
          attested?: boolean
          attested_at?: string | null
          audience: Database["public"]["Enums"]["training_audience"]
          body: string
          created_at?: string
          created_by: string
          id?: string
          org_id?: string | null
          published?: boolean
          published_at?: string | null
          published_by?: string | null
          source?: Database["public"]["Enums"]["training_source"]
          source_file_name?: string | null
          source_mime_type?: string | null
          source_object_path?: string | null
          source_size_bytes?: number | null
          source_uploaded_at?: string | null
          takedown_reason?: string | null
          taken_down_at?: string | null
          taken_down_by?: string | null
          title: string
          updated_at?: string
          video_url: string
        }
        Update: {
          attestation_text?: string | null
          attested?: boolean
          attested_at?: string | null
          audience?: Database["public"]["Enums"]["training_audience"]
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string | null
          published?: boolean
          published_at?: string | null
          published_by?: string | null
          source?: Database["public"]["Enums"]["training_source"]
          source_file_name?: string | null
          source_mime_type?: string | null
          source_object_path?: string | null
          source_size_bytes?: number | null
          source_uploaded_at?: string | null
          takedown_reason?: string | null
          taken_down_at?: string | null
          taken_down_by?: string | null
          title?: string
          updated_at?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trainings_taken_down_by_fkey"
            columns: ["taken_down_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_writeback_outbox: {
        Row: {
          bank_ref: string
          delivered_at: string | null
          failure_code: string | null
          id: string
          outcome_id: string
          payload: Json
          recorded_at: string
          source: string
          state: string
          target: string
        }
        Insert: {
          bank_ref: string
          delivered_at?: string | null
          failure_code?: string | null
          id?: string
          outcome_id: string
          payload: Json
          recorded_at?: string
          source?: string
          state?: string
          target: string
        }
        Update: {
          bank_ref?: string
          delivered_at?: string | null
          failure_code?: string | null
          id?: string
          outcome_id?: string
          payload?: Json
          recorded_at?: string
          source?: string
          state?: string
          target?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_writeback_outbox_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: true
            referencedRelation: "outcomes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      affiliate_client_view: {
        Row: {
          expected_commission_cents: number | null
          funded_amount_cents: number | null
          payment_status:
            | Database["public"]["Enums"]["affiliate_payment_status"]
            | null
          stage: Database["public"]["Enums"]["client_stage"] | null
          started_at: string | null
        }
        Relationships: []
      }
      notification_delivery_dispatch_view: {
        Row: {
          billing_event_id: string | null
          channel:
            | Database["public"]["Enums"]["notification_delivery_channel"]
            | null
          dispatch_subject: string | null
          dispatch_window: string | null
          email_template: string | null
          id: string | null
          org_id: string | null
          status:
            | Database["public"]["Enums"]["notification_delivery_status"]
            | null
        }
        Insert: {
          billing_event_id?: string | null
          channel?:
            | Database["public"]["Enums"]["notification_delivery_channel"]
            | null
          dispatch_subject?: string | null
          dispatch_window?: string | null
          email_template?: string | null
          id?: string | null
          org_id?: string | null
          status?:
            | Database["public"]["Enums"]["notification_delivery_status"]
            | null
        }
        Update: {
          billing_event_id?: string | null
          channel?:
            | Database["public"]["Enums"]["notification_delivery_channel"]
            | null
          dispatch_subject?: string | null
          dispatch_window?: string | null
          email_template?: string | null
          id?: string | null
          org_id?: string | null
          status?:
            | Database["public"]["Enums"]["notification_delivery_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_outbox_billing_event_id_fkey"
            columns: ["billing_event_id"]
            isOneToOne: false
            referencedRelation: "operator_billing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_brand_view: {
        Row: {
          brand: Json | null
          brand_published_at: string | null
          id: string | null
          name: string | null
          slug: string | null
        }
        Insert: {
          brand?: Json | null
          brand_published_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          brand?: Json | null
          brand_published_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      specialist_default_client_view: {
        Row: {
          affiliate_id: string | null
          assigned_to: string | null
          business_name: string | null
          consumer_profile_id: string | null
          created_at: string | null
          display_name: string | null
          funded_amount_cents: number | null
          goal_cents: number | null
          id: string | null
          matches_unlocked_override: boolean | null
          org_id: string | null
          stage: Database["public"]["Enums"]["client_stage"] | null
          stage_entered_at: string | null
          started_at: string | null
        }
        Insert: {
          affiliate_id?: string | null
          assigned_to?: string | null
          business_name?: string | null
          consumer_profile_id?: string | null
          created_at?: string | null
          display_name?: string | null
          funded_amount_cents?: number | null
          goal_cents?: number | null
          id?: string | null
          matches_unlocked_override?: boolean | null
          org_id?: string | null
          stage?: Database["public"]["Enums"]["client_stage"] | null
          stage_entered_at?: string | null
          started_at?: string | null
        }
        Update: {
          affiliate_id?: string | null
          assigned_to?: string | null
          business_name?: string | null
          consumer_profile_id?: string | null
          created_at?: string | null
          display_name?: string | null
          funded_amount_cents?: number | null
          goal_cents?: number | null
          id?: string | null
          matches_unlocked_override?: boolean | null
          org_id?: string | null
          stage?: Database["public"]["Enums"]["client_stage"] | null
          stage_entered_at?: string | null
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_affiliate_org_fk"
            columns: ["affiliate_id", "org_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_assignee_org_fk"
            columns: ["assigned_to", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_consumer_org_fk"
            columns: ["consumer_profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "org_brand_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_email_delivery: {
        Args: { p_provider_ref: string; p_receipt_id: string }
        Returns: {
          attempt_count: number
          delivery_id: string
          provider_ref: string
          receipt_id: string
          status: string
          template: string
        }[]
      }
      admin_activate_prompt_version: {
        Args: {
          p_actor: string
          p_driver: string
          p_key: string
          p_model: string
          p_policy_version: string
          p_reference_dataset_hash: string
          p_version: number
        }
        Returns: {
          prompt_active: boolean
          prompt_body: string
          prompt_created_at: string
          prompt_created_by: string
          prompt_key: string
          prompt_version: number
          reason: Database["public"]["Enums"]["prompt_activation_hold_reason"]
          status: Database["public"]["Enums"]["prompt_activation_status"]
        }[]
      }
      admin_compute_kpi_metrics: {
        Args: { p_day: string; p_scope: string; p_subject_id: string }
        Returns: Json
      }
      admin_create_prompt_version: {
        Args: {
          p_actor: string
          p_body: string
          p_fallback_body: string
          p_key: string
        }
        Returns: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          key: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "prompts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_record_eval_run: {
        Args: {
          p_actor?: string
          p_driver: string
          p_eligible: boolean
          p_evaluator_key: string
          p_model: string
          p_passed: boolean
          p_policy_version: string
          p_prompt_key: string
          p_prompt_version: number
          p_reference_dataset_hash: string
          p_result: Json
        }
        Returns: {
          driver: string
          eligible: boolean
          evaluator_key: string
          id: string
          model: string
          passed: boolean
          policy_version: string
          prompt_key: string
          prompt_version: number
          ran_at: string
          ran_by: string | null
          reference_dataset_hash: string
          result: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "eval_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_set_layout: {
        Args: { p_actor: string; p_layout: Json }
        Returns: {
          layout: Json
          profile_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_layouts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_set_setting: {
        Args: { p_actor: string; p_key: string; p_value: Json }
        Returns: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_upsert_kpi_rollup: {
        Args: { p_day: string; p_scope: string; p_subject_id: string }
        Returns: {
          day: string
          metrics: Json
          scope: string
          subject_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "kpi_rollups"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      affiliate_referral_valid: { Args: { p_aff: string }; Returns: boolean }
      affiliate_share_client: {
        Args: { p_affiliate_id: string; p_client_id: string }
        Returns: {
          affiliate_id: string
          client_id: string
          expected_commission_cents: number
          inserted: boolean
          payment_status: Database["public"]["Enums"]["affiliate_payment_status"]
        }[]
      }
      affiliate_unshare_client: {
        Args: { p_affiliate_id: string; p_client_id: string }
        Returns: boolean
      }
      affiliate_update_share: {
        Args: { p_affiliate_id: string; p_client_id: string; p_patch: Json }
        Returns: {
          affiliate_id: string
          changed: boolean
          client_id: string
          expected_commission_cents: number
          payment_status: Database["public"]["Enums"]["affiliate_payment_status"]
        }[]
      }
      operator_affiliate_roster: {
        Args: Record<PropertyKey, never>
        Returns: {
          active: boolean
          affiliate_id: string
          default_commission_bps: number
          email: string
          expected_commission_cents: number
          name: string
          paid_commission_cents: number
          profile_id: string
          referral_slug: string
          shared_clients: number
        }[]
      }
      operator_affiliate_statement: {
        Args: { p_affiliate_id: string }
        Returns: {
          affiliate_id: string
          client_id: string
          client_name: string
          commission_override: boolean
          expected_commission_cents: number
          funded_amount_cents: number
          payment_status: Database["public"]["Enums"]["affiliate_payment_status"]
          stage: Database["public"]["Enums"]["client_stage"]
          started_at: string
        }[]
      }
      operator_affiliate_update: {
        Args: { p_affiliate_id: string; p_patch: Json }
        Returns: {
          active: boolean
          affiliate_id: string
          changed: boolean
          default_commission_bps: number
        }[]
      }
      analysis_is_authorized: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      assert_pull_allowed: {
        Args: { p_cause: string; p_client_id: string; p_source_id: string }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      begin_consumer_subscription_attempt: {
        Args: { p_enrollment_id: string; p_operation_id: string }
        Returns: {
          activated_at: string | null
          attempt_provider_amount_cents: number | null
          attempt_provider_currency: string | null
          attempt_provider_returned_at: string | null
          attempt_provider_status: string | null
          attempt_provider_subscription_ref: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          currency: string
          customer_ref: string
          enrollment_id: string
          id: string
          idempotency_key: string
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          last_provider_status: string | null
          operation_id: string | null
          operation_started_at: string | null
          operation_state: string
          payment_method_ref: string | null
          price_cents: number
          price_ref: string | null
          provider: string
          provider_amount_cents: number | null
          provider_cancel_completed_at: string | null
          provider_cancel_reason: string | null
          provider_cancel_ref: string | null
          provider_cancel_requested_at: string | null
          provider_currency: string | null
          provider_status: string | null
          review_code: string | null
          setup_intent_ref: string | null
          status: string
          subscription_attempt_at: string | null
          subscription_ref: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "consumer_subscriptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      begin_paid_refresh_payment_attempt: {
        Args: { p_idempotency_key: string; p_request_id: string }
        Returns: {
          payment_attempt_state: string
          payment_dispatch_started_at: string
          payment_idempotency_key: string
          payment_provider_event_key: string
          payment_provider_outcome: string
          payment_provider_payment_ref: string
          payment_provider_returned_at: string
        }[]
      }
      billing_attribute_unmatched_refunds: {
        Args: { p_source?: string }
        Returns: Json
      }
      billing_raise_client_cap: {
        Args: { p_actor_profile_id: string; p_cap: number; p_org_id: string }
        Returns: Json
      }
      billing_read_client_cap: {
        Args: { p_org_id: string }
        Returns: {
          active_count: number
          client_cap: number
        }[]
      }
      billing_record_refund_observation: {
        Args: {
          p_charge_ref: string
          p_cumulative_amount_refunded_cents: number
          p_currency: string
          p_customer_ref: string
          p_event_id: string
          p_occurred_at: string
          p_subscription_ref: string
        }
        Returns: Json
      }
      claim_analysis_job:
        | {
            Args: {
              p_analysis_run_id: string
              p_client_id: string
              p_lease_seconds: number
              p_worker_id: string
            }
            Returns: {
              analysis_run_id: string
              attempt_count: number
              available_at: string
              client_id: string
              created_at: string
              error_code:
                | Database["public"]["Enums"]["analysis_job_error_code"]
                | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              source_id: string
              source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
              status: Database["public"]["Enums"]["analysis_job_status"]
              subject: string | null
              trigger: Database["public"]["Enums"]["analysis_trigger"]
              updated_at: string
              window: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "analysis_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_lease_seconds: number; p_worker_id: string }
            Returns: {
              analysis_run_id: string
              attempt_count: number
              available_at: string
              client_id: string
              created_at: string
              error_code:
                | Database["public"]["Enums"]["analysis_job_error_code"]
                | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              source_id: string
              source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
              status: Database["public"]["Enums"]["analysis_job_status"]
              subject: string | null
              trigger: Database["public"]["Enums"]["analysis_trigger"]
              updated_at: string
              window: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "analysis_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_background_job:
        | {
            Args: {
              p_job_id: string
              p_lease_seconds?: number
              p_worker_id: string
            }
            Returns: {
              attempt_count: number
              available_at: string
              completed_at: string | null
              created_at: string
              error_code: string | null
              execution_started_at: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              rows_processed: number | null
              status: Database["public"]["Enums"]["background_job_status"]
              subject: string
              updated_at: string
              window: string
            }[]
            SetofOptions: {
              from: "*"
              to: "background_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_allowed_jobs: string[]
              p_job_id: string
              p_lease_seconds: number
              p_worker_id: string
            }
            Returns: {
              attempt_count: number
              available_at: string
              completed_at: string | null
              created_at: string
              error_code: string | null
              execution_started_at: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              rows_processed: number | null
              status: Database["public"]["Enums"]["background_job_status"]
              subject: string
              updated_at: string
              window: string
            }[]
            SetofOptions: {
              from: "*"
              to: "background_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_background_jobs:
        | {
            Args: {
              p_lease_seconds?: number
              p_max_jobs: number
              p_worker_id: string
            }
            Returns: {
              attempt_count: number
              available_at: string
              completed_at: string | null
              created_at: string
              error_code: string | null
              execution_started_at: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              rows_processed: number | null
              status: Database["public"]["Enums"]["background_job_status"]
              subject: string
              updated_at: string
              window: string
            }[]
            SetofOptions: {
              from: "*"
              to: "background_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: {
              p_allowed_jobs: string[]
              p_lease_seconds: number
              p_max_jobs: number
              p_worker_id: string
            }
            Returns: {
              attempt_count: number
              available_at: string
              completed_at: string | null
              created_at: string
              error_code: string | null
              execution_started_at: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              rows_processed: number | null
              status: Database["public"]["Enums"]["background_job_status"]
              subject: string
              updated_at: string
              window: string
            }[]
            SetofOptions: {
              from: "*"
              to: "background_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_email_delivery: {
        Args: { p_delivery_id: string; p_recipient: string; p_template: string }
        Returns: {
          attempt_count: number
          delivery_id: string
          provider_ref: string
          receipt_id: string
          status: string
          template: string
        }[]
      }
      claim_outcome_refresh_job:
        | {
            Args: {
              p_bank_ref: string
              p_change_id: string
              p_lease_seconds?: number
              p_worker_id: string
            }
            Returns: {
              attempt_count: number
              available_at: string
              bank_ref: string
              change_id: string
              created_at: string
              error_code: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              status: Database["public"]["Enums"]["outcome_job_status"]
              subject: string | null
              updated_at: string
              window: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "outcome_refresh_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_lease_seconds?: number; p_worker_id: string }
            Returns: {
              attempt_count: number
              available_at: string
              bank_ref: string
              change_id: string
              created_at: string
              error_code: string | null
              id: string
              idempotency_key: string | null
              job: string
              lease_owner: string | null
              lease_until: string | null
              status: Database["public"]["Enums"]["outcome_job_status"]
              subject: string | null
              updated_at: string
              window: string | null
            }[]
            SetofOptions: {
              from: "*"
              to: "outcome_refresh_jobs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_stripe_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_lease_owner: string
          p_lease_seconds?: number
        }
        Returns: boolean
      }
      clear_pull_cap: {
        Args: { p_actor: string; p_client_id: string }
        Returns: boolean
      }
      commit_paid_refresh_pull: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      complete_background_job: {
        Args: {
          p_job_id: string
          p_rows_processed?: number
          p_status: Database["public"]["Enums"]["background_job_status"]
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          execution_started_at: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          rows_processed: number | null
          status: Database["public"]["Enums"]["background_job_status"]
          subject: string
          updated_at: string
          window: string
        }[]
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      consumer_subscription_apply_event: {
        Args: {
          p_enrollment_id: string
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_provider_status: string
          p_source?: string
        }
        Returns: Json
      }
      consumer_subscription_pending_provider_cancel: {
        Args: { p_enrollment_id: string }
        Returns: Json
      }
      consumer_subscription_provider_cancel_completed: {
        Args: { p_enrollment_id: string; p_subscription_ref: string }
        Returns: Json
      }
      consumer_update_profile: {
        Args: { p_full_name: string; p_phone: string }
        Returns: {
          email: string
          full_name: string
          phone: string
        }[]
      }
      create_paid_refresh_request: {
        Args: {
          p_actor_profile_id: string
          p_amount_cents: number
          p_client_id: string
          p_currency: string
          p_driver: string
          p_idempotency_key: string
        }
        Returns: {
          actor_profile_id: string
          amount_cents: number
          analysis_run_id: string | null
          client_id: string
          created_at: string
          currency: string
          driver: string
          id: string
          idempotency_key: string
          org_id: string
          payment_attempt_state: string
          payment_dispatch_started_at: string | null
          payment_idempotency_key: string | null
          payment_provider_event_key: string | null
          payment_provider_outcome: string | null
          payment_provider_payment_ref: string | null
          payment_provider_returned_at: string | null
          provider_payment_ref: string | null
          state: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "paid_refresh_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dispatch_notification: {
        Args: { p_subject: string; p_window: string; p_worker: string }
        Returns: {
          rows: number
          status: string
        }[]
      }
      enqueue_analysis_job: {
        Args: {
          p_client_id: string
          p_source_id: string
          p_source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          p_trigger: Database["public"]["Enums"]["analysis_trigger"]
        }
        Returns: {
          analysis_run_id: string
          attempt_count: number
          available_at: string
          client_id: string
          created_at: string
          error_code:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status: Database["public"]["Enums"]["analysis_job_status"]
          subject: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_background_job: {
        Args: { p_job: string; p_subject: string; p_window: string }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          execution_started_at: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          rows_processed: number | null
          status: Database["public"]["Enums"]["background_job_status"]
          subject: string
          updated_at: string
          window: string
        }[]
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_operator_card_failure_email: {
        Args: { p_event_id: string; p_org_id: string }
        Returns: {
          delivery_id: string
          inserted: boolean
        }[]
      }
      enqueue_outcome_refresh_job: {
        Args: { p_bank_ref: string; p_change_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          bank_ref: string
          change_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          status: Database["public"]["Enums"]["outcome_job_status"]
          subject: string | null
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "outcome_refresh_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enrollment_begin:
        | {
            Args: {
              p_actor_id: string
              p_agreement_version: string
              p_analysis_version: string
              p_client_id: string
              p_draft_id: string
              p_ip: unknown
              p_monitoring_version: string
              p_signer_name: string
              p_typed_signature: string
              p_user_agent: string
            }
            Returns: {
              enrollment_id: string
              esignature_id: string
            }[]
          }
        | {
            Args: {
              p_actor_id: string
              p_aff: string
              p_agreement_version: string
              p_analysis_version: string
              p_client_id: string
              p_draft_id: string
              p_ip: unknown
              p_monitoring_version: string
              p_signer_name: string
              p_typed_signature: string
              p_user_agent: string
            }
            Returns: {
              enrollment_id: string
              esignature_id: string
            }[]
          }
      enrollment_cancel_sub: {
        Args: { p_actor_id: string; p_enrollment_id: string; p_reason: string }
        Returns: Json
      }
      enrollment_idv_settled: {
        Args: {
          p_actor_id: string
          p_enrollment_id: string
          p_locked_until: string
          p_next_state: string
          p_outcome: string
          p_parked_until: string
        }
        Returns: undefined
      }
      enrollment_idv_started: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_driver: string
          p_enrollment_id: string
          p_kind: string
          p_max_attempts: number
          p_member_ref: string
        }
        Returns: undefined
      }
      enrollment_record_milestone: {
        Args: { p_actor_id: string; p_client_id: string; p_kind: string }
        Returns: undefined
      }
      enrollment_record_setup: {
        Args: {
          p_actor_id: string
          p_client_id: string
          p_customer_ref: string
          p_enrollment_id: string
          p_idempotency_key: string
          p_payment_method_ref: string
          p_price_cents: number
          p_price_ref: string
          p_provider: string
          p_setup_intent_ref: string
        }
        Returns: undefined
      }
      enrollment_review_sub: {
        Args: {
          p_actor_id: string
          p_amount_cents: number
          p_currency: string
          p_enrollment_id: string
          p_provider_status: string
          p_review_code: string
          p_subscription_ref: string
        }
        Returns: undefined
      }
      enrollment_revoke_consent: {
        Args: { p_actor_id: string; p_client_id: string; p_kind: string }
        Returns: undefined
      }
      enrollment_settle_sub: {
        Args: {
          p_actor_id: string
          p_enrollment_id: string
          p_subscription_ref: string
        }
        Returns: Json
      }
      fail_analysis_job: {
        Args: {
          p_error_code: Database["public"]["Enums"]["analysis_job_error_code"]
          p_job_id: string
          p_retry: boolean
          p_retry_after_seconds: number
          p_worker_id: string
        }
        Returns: {
          analysis_run_id: string
          attempt_count: number
          available_at: string
          client_id: string
          created_at: string
          error_code:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status: Database["public"]["Enums"]["analysis_job_status"]
          subject: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fail_background_job: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_retry: boolean
          p_retry_after_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          execution_started_at: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          rows_processed: number | null
          status: Database["public"]["Enums"]["background_job_status"]
          subject: string
          updated_at: string
          window: string
        }[]
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fail_email_delivery: {
        Args: { p_error_code: string; p_receipt_id: string }
        Returns: {
          attempt_count: number
          delivery_id: string
          provider_ref: string
          receipt_id: string
          status: string
          template: string
        }[]
      }
      fail_outcome_refresh_job: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_retry?: boolean
          p_retry_after_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          available_at: string
          bank_ref: string
          change_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          status: Database["public"]["Enums"]["outcome_job_status"]
          subject: string | null
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "outcome_refresh_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fees_list_org_receivables: {
        Args: { p_limit?: number; p_offset?: number; p_org_id: string }
        Returns: {
          balance_cents: number
          client_id: string
          display_name: string
          last_payment_on: string
          model: Database["public"]["Enums"]["fee_model"]
          paid_cents: number
          status: Database["public"]["Enums"]["fee_agreement_status"]
          total_cents: number
        }[]
      }
      fees_read_client_fees: { Args: { p_client_id: string }; Returns: Json }
      fees_record_payment: {
        Args: {
          p_amount_cents: number
          p_client_id: string
          p_method: Database["public"]["Enums"]["fee_payment_method"]
          p_note?: string
          p_received_on: string
          p_reference?: string
        }
        Returns: {
          amount_cents: number
          client_id: string
          id: string
          method: Database["public"]["Enums"]["fee_payment_method"]
          note: string | null
          org_id: string
          received_on: string
          recorded_at: string
          recorded_by: string
          reference: string | null
          reversed_at: string | null
          reversed_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "fee_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_reverse_payment: {
        Args: { p_payment_id: string }
        Returns: {
          amount_cents: number
          client_id: string
          id: string
          method: Database["public"]["Enums"]["fee_payment_method"]
          note: string | null
          org_id: string
          received_on: string
          recorded_at: string
          recorded_by: string
          reference: string | null
          reversed_at: string | null
          reversed_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "fee_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_set_agreement: {
        Args: {
          p_client_id: string
          p_custom_total_cents?: number
          p_model: Database["public"]["Enums"]["fee_model"]
          p_pct?: number
          p_status?: Database["public"]["Enums"]["fee_agreement_status"]
          p_success_cents?: number
          p_trigger_cents?: number
          p_upfront_cents?: number
        }
        Returns: {
          client_id: string
          created_at: string
          custom_total_cents: number | null
          id: string
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct: number | null
          source: string
          status: Database["public"]["Enums"]["fee_agreement_status"]
          success_cents: number | null
          trigger_cents: number | null
          updated_at: string
          upfront_cents: number | null
        }
        SetofOptions: {
          from: "*"
          to: "fee_agreements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_set_org_default: {
        Args: {
          p_custom_total_cents?: number
          p_model: Database["public"]["Enums"]["fee_model"]
          p_org_id: string
          p_pct?: number
          p_success_cents?: number
          p_trigger_cents?: number
          p_upfront_cents?: number
        }
        Returns: {
          custom_total_cents: number | null
          model: Database["public"]["Enums"]["fee_model"]
          org_id: string
          pct: number | null
          success_cents: number | null
          trigger_cents: number | null
          updated_at: string
          updated_by: string
          upfront_cents: number | null
        }
        SetofOptions: {
          from: "*"
          to: "org_fee_defaults"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_set_outcome_basis: {
        Args: { p_basis_cents: number; p_client_id: string; p_source?: string }
        Returns: {
          balance_cents: number | null
          client_id: string
          org_id: string
          outcome_basis_cents: number
          outcome_basis_source: string | null
          paid_cents: number
          total_cents: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fee_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fees_upfront_gate_state: {
        Args: { p_org_id: string }
        Returns: {
          approved: boolean
          approved_at: string
          signoff_ref: string
        }[]
      }
      finish_analysis_job: {
        Args: { p_job_id: string; p_worker_id: string }
        Returns: {
          analysis_run_id: string
          attempt_count: number
          available_at: string
          client_id: string
          created_at: string
          error_code:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status: Database["public"]["Enums"]["analysis_job_status"]
          subject: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      finish_stripe_webhook_event: {
        Args: {
          p_error_code?: string
          p_event_id: string
          p_lease_owner: string
          p_status: string
        }
        Returns: boolean
      }
      insert_crs_alert_notification: {
        Args: { p_monitoring_event_id: string }
        Returns: {
          inserted: boolean
          notification_id: string
        }[]
      }
      kb_apply_article: {
        Args: {
          p_body: string
          p_embedding: number[]
          p_embedding_version: string
          p_metadata: Json
          p_next_cursor: string
          p_run_id: string
          p_source_article_id: string
          p_source_checksum: string
          p_source_updated_at: string
          p_source_url: string
          p_title: string
        }
        Returns: string
      }
      kb_begin_import: {
        Args: { p_driver: string; p_subject: string; p_window: string }
        Returns: {
          added_count: number
          changed_count: number
          completed_at: string | null
          cursor: string | null
          driver: string
          embedded_count: number
          error_code: string | null
          id: string
          idempotency_key: string | null
          restored_count: number
          source_count: number
          started_at: string
          status: Database["public"]["Enums"]["kb_import_status"]
          subject: string
          tombstoned_count: number
          unchanged_count: number
          updated_at: string
          window: string
        }
        SetofOptions: {
          from: "*"
          to: "kb_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kb_complete_import: {
        Args: { p_run_id: string }
        Returns: {
          added_count: number
          changed_count: number
          completed_at: string | null
          cursor: string | null
          driver: string
          embedded_count: number
          error_code: string | null
          id: string
          idempotency_key: string | null
          restored_count: number
          source_count: number
          started_at: string
          status: Database["public"]["Enums"]["kb_import_status"]
          subject: string
          tombstoned_count: number
          unchanged_count: number
          updated_at: string
          window: string
        }
        SetofOptions: {
          from: "*"
          to: "kb_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kb_fail_import: {
        Args: { p_error_code: string; p_run_id: string }
        Returns: {
          added_count: number
          changed_count: number
          completed_at: string | null
          cursor: string | null
          driver: string
          embedded_count: number
          error_code: string | null
          id: string
          idempotency_key: string | null
          restored_count: number
          source_count: number
          started_at: string
          status: Database["public"]["Enums"]["kb_import_status"]
          subject: string
          tombstoned_count: number
          unchanged_count: number
          updated_at: string
          window: string
        }
        SetofOptions: {
          from: "*"
          to: "kb_import_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_paid_refresh_analysis: {
        Args: { p_analysis_run_id: string; p_request_id: string }
        Returns: {
          actor_profile_id: string
          amount_cents: number
          analysis_run_id: string | null
          client_id: string
          created_at: string
          currency: string
          driver: string
          id: string
          idempotency_key: string
          org_id: string
          payment_attempt_state: string
          payment_dispatch_started_at: string | null
          payment_idempotency_key: string | null
          payment_provider_event_key: string | null
          payment_provider_outcome: string | null
          payment_provider_payment_ref: string | null
          payment_provider_returned_at: string | null
          provider_payment_ref: string | null
          state: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "paid_refresh_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_derived_purge_targets: {
        Args: { p_limit?: number; p_stale_before: string }
        Returns: {
          enrollment_id: string
        }[]
      }
      mark_paid_refresh_payment_needs_review: {
        Args: { p_idempotency_key: string; p_request_id: string }
        Returns: boolean
      }
      mark_purged_and_enqueue_analysis: {
        Args: { p_upload_id: string }
        Returns: boolean
      }
      monitoring_is_authorized: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      operator_billing_apply_event: {
        Args: {
          p_attempt_count: number
          p_current_period_end: string
          p_event_id: string
          p_event_type: string
          p_next_attempt_at: string
          p_occurred_at: string
          p_org_id: string
          p_source?: string
          p_status: string
          p_subscription_ref: string
        }
        Returns: Json
      }
      operator_billing_apply_event_convergent: {
        Args: {
          p_attempt_count: number
          p_current_period_end: string
          p_event_id: string
          p_event_type: string
          p_next_attempt_at: string
          p_occurred_at: string
          p_org_id: string
          p_source?: string
          p_status: string
          p_subscription_ref: string
        }
        Returns: Json
      }
      operator_billing_change_plan: {
        Args: { p_base_price_ref: string; p_org_id: string; p_plan: string }
        Returns: Json
      }
      operator_billing_claim_subscription_intent: {
        Args: { p_creation_path: string; p_org_id: string }
        Returns: Json
      }
      operator_billing_complete_subscription_intent: {
        Args: {
          p_creation_path: string
          p_operation_id: string
          p_org_id: string
          p_provider_ref: string
        }
        Returns: Json
      }
      operator_billing_fail_expired_checkout_intent: {
        Args: {
          p_operation_id: string
          p_org_id: string
          p_provider_ref: string
        }
        Returns: Json
      }
      operator_billing_review_subscription_intent: {
        Args: {
          p_operation_id: string
          p_org_id: string
          p_reason_code: string
        }
        Returns: Json
      }
      operator_billing_set_seat_quantity: {
        Args: {
          p_generation: string
          p_org_id: string
          p_quantity: number
          p_source: string
        }
        Returns: Json
      }
      operator_billing_upsert_subscription: {
        Args: {
          p_base_item_ref: string
          p_base_price_ref: string
          p_current_period_end: string
          p_customer_ref: string
          p_org_id: string
          p_provider: string
          p_seat_item_ref: string
          p_seat_price_ref: string
          p_status: string
          p_subscription_ref: string
        }
        Returns: Json
      }
      operator_seat_sync_prepare: {
        Args: { p_org_id: string }
        Returns: {
          attempts: number
          desired_quantity: number
          generation: string
          org_id: string
          status: string
        }[]
      }
      operator_seat_sync_record_failure: {
        Args: { p_error_code: string; p_generation: string; p_org_id: string }
        Returns: Json
      }
      org_flags_set_upfront_fee_approved: {
        Args: { p_approved: boolean; p_org_id: string; p_signoff_ref?: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          legal_signoff_ref: string | null
          org_id: string
          updated_at: string
          upfront_fee_approved: boolean
        }
        SetofOptions: {
          from: "*"
          to: "org_flags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      persist_analysis_result: {
        Args: {
          p_analysis_run_id: string
          p_client_id: string
          p_derived: Json
          p_job_id: string
          p_plan_body: Json
          p_plan_version: number
          p_readiness_score: number
          p_worker_id: string
        }
        Returns: {
          analysis_run_id: string
          attempt_count: number
          available_at: string
          client_id: string
          created_at: string
          error_code:
            | Database["public"]["Enums"]["analysis_job_error_code"]
            | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          source_id: string
          source_kind: Database["public"]["Enums"]["analysis_job_source_kind"]
          status: Database["public"]["Enums"]["analysis_job_status"]
          subject: string | null
          trigger: Database["public"]["Enums"]["analysis_trigger"]
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      publish_training: {
        Args: {
          p_actor: string
          p_attestation_text: string
          p_attested: boolean
          p_id: string
        }
        Returns: {
          attestation_text: string | null
          attested: boolean
          attested_at: string | null
          audience: Database["public"]["Enums"]["training_audience"]
          body: string
          created_at: string
          created_by: string
          id: string
          org_id: string | null
          published: boolean
          published_at: string | null
          published_by: string | null
          source: Database["public"]["Enums"]["training_source"]
          source_file_name: string | null
          source_mime_type: string | null
          source_object_path: string | null
          source_size_bytes: number | null
          source_uploaded_at: string | null
          takedown_reason: string | null
          taken_down_at: string | null
          taken_down_by: string | null
          title: string
          updated_at: string
          video_url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trainings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      purge_derived_enrollment: {
        Args: { p_closed_member_ref: string; p_enrollment_id: string }
        Returns: number
      }
      read_paid_refresh_request: {
        Args: { p_request_id: string }
        Returns: {
          actor_profile_id: string
          amount_cents: number
          analysis_run_id: string
          client_id: string
          currency: string
          driver: string
          latest_payment_outcome: string
          payment_attempt_state: string
          payment_dispatch_started_at: string
          payment_idempotency_key: string
          payment_provider_event_key: string
          payment_provider_outcome: string
          payment_provider_payment_ref: string
          payment_provider_returned_at: string
          payment_succeeded: boolean
          provider_payment_ref: string
          request_id: string
          state: string
        }[]
      }
      record_consumer_subscription_provider_returned: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_enrollment_id: string
          p_operation_id: string
          p_status: string
          p_subscription_ref: string
        }
        Returns: {
          activated_at: string | null
          attempt_provider_amount_cents: number | null
          attempt_provider_currency: string | null
          attempt_provider_returned_at: string | null
          attempt_provider_status: string | null
          attempt_provider_subscription_ref: string | null
          cancelled_at: string | null
          client_id: string
          created_at: string
          currency: string
          customer_ref: string
          enrollment_id: string
          id: string
          idempotency_key: string
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          last_provider_status: string | null
          operation_id: string | null
          operation_started_at: string | null
          operation_state: string
          payment_method_ref: string | null
          price_cents: number
          price_ref: string | null
          provider: string
          provider_amount_cents: number | null
          provider_cancel_completed_at: string | null
          provider_cancel_reason: string | null
          provider_cancel_ref: string | null
          provider_cancel_requested_at: string | null
          provider_currency: string | null
          provider_status: string | null
          review_code: string | null
          setup_intent_ref: string | null
          status: string
          subscription_attempt_at: string | null
          subscription_ref: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "consumer_subscriptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_outcome: {
        Args: {
          p_actor?: string
          p_amount_cents: number
          p_application_id: string
          p_decided_on: string
          p_kind: Database["public"]["Enums"]["outcome_kind"]
        }
        Returns: string
      }
      record_paid_refresh_payment_event: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_outcome: string
          p_provider_event_key: string
          p_provider_payment_ref: string
          p_request_id: string
        }
        Returns: {
          amount_cents: number
          currency: string
          id: string
          occurred_at: string
          outcome: string
          provider_event_key: string
          provider_payment_ref: string
          request_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "paid_refresh_payment_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_paid_refresh_provider_returned: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_idempotency_key: string
          p_outcome: string
          p_provider_event_key: string
          p_provider_payment_ref: string
          p_request_id: string
        }
        Returns: {
          payment_attempt_state: string
          payment_dispatch_started_at: string
          payment_idempotency_key: string
          payment_provider_event_key: string
          payment_provider_outcome: string
          payment_provider_payment_ref: string
          payment_provider_returned_at: string
        }[]
      }
      referral_create: {
        Args: {
          p_consumer_id: string
          p_platform_org_id: string
          p_source_client_id: string
          p_token_hash: string
        }
        Returns: {
          clicked_at: string
          converted_at: string
          converted_client_id: string
          created_at: string
          platform_org_id: string
          referral_id: string
          source_org_id: string
        }[]
      }
      referral_mark_clicked: {
        Args: { p_token_hash: string }
        Returns: {
          clicked_at: string
          converted_at: string
          converted_client_id: string
          created_at: string
          platform_org_id: string
          referral_id: string
          source_org_id: string
        }[]
      }
      referral_mark_converted: {
        Args: {
          p_actor_id: string
          p_converted_client_id: string
          p_token_hash: string
        }
        Returns: {
          clicked_at: string
          converted_at: string
          converted_client_id: string
          created_at: string
          platform_org_id: string
          referral_id: string
          source_org_id: string
          status: string
        }[]
      }
      release_paid_refresh_pull: {
        Args: { p_request_id: string }
        Returns: boolean
      }
      renew_background_job_lease: {
        Args: {
          p_job_id: string
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: Json
      }
      reserve_paid_refresh_pull: {
        Args: {
          p_client_id: string
          p_lease_seconds?: number
          p_request_id: string
        }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      revenue_list_accrual_orgs: {
        Args: never
        Returns: {
          operator_org_id: string
        }[]
      }
      revenue_mark_settlement: {
        Args: {
          p_actor_id: string
          p_expected_status: Database["public"]["Enums"]["settlement_status"]
          p_ledger_id: string
          p_ledger_kind: string
          p_status: Database["public"]["Enums"]["settlement_status"]
        }
        Returns: Json
      }
      revenue_post_billing_accrual: {
        Args: {
          p_accrual_month: string
          p_operator_amount_cents: number
          p_operator_base_amount_cents: number
          p_operator_incomplete_code: string
          p_operator_is_complete: boolean
          p_operator_org_id: string
          p_operator_pct_snapshot: number
          p_operator_source_row_count: number
          p_referral_snapshots?: Json
        }
        Returns: {
          operator_rows: number
          referral_rows: number
        }[]
      }
      revenue_read_accrual_inputs: {
        Args: { p_accrual_month: string; p_operator_org_id: string }
        Returns: {
          consumer_subscriptions: Json
          operator_org_id: string
          operator_subscription: Json
          org_base_price_cents: number
          org_seat_price_cents: number
          referral: Json
          refund_amount_cents: number
        }[]
      }
      revenue_read_kpis: {
        Args: { p_accrual_month: string }
        Returns: {
          expected_operator_rows: number
          expected_referral_rows: number
          incomplete_codes: string[]
          is_complete: boolean
          monitoring_share_total_cents: number
          present_operator_rows: number
          present_referral_rows: number
          saas_referral_total_cents: number
        }[]
      }
      revenue_read_refund_total: {
        Args: { p_accrual_month: string; p_org_id: string }
        Returns: number
      }
      revenue_read_settlement_status: {
        Args: { p_ledger_id: string; p_ledger_kind: string }
        Returns: Json
      }
      review_outcome: {
        Args: {
          p_actor: string
          p_decision: Database["public"]["Enums"]["outcome_review_state"]
          p_outcome_id: string
        }
        Returns: {
          notified: boolean
          outbox_state: string
          result: string
          review_state: Database["public"]["Enums"]["outcome_review_state"]
        }[]
      }
      run_outcome_refresh_job: {
        Args: { p_job_id: string; p_worker_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          bank_ref: string
          change_id: string
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          job: string
          lease_owner: string | null
          lease_until: string | null
          status: Database["public"]["Enums"]["outcome_job_status"]
          subject: string | null
          updated_at: string
          window: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "outcome_refresh_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      scrub_expired_crs_alert_pointers: {
        Args: { p_limit?: number; p_now: string }
        Returns: number
      }
      search_kb_articles: {
        Args: { p_embedding: number[]; p_limit?: number }
        Returns: {
          body: string
          id: string
          metadata: Json
          similarity: number
          source_article_id: string
          source_updated_at: string
          source_url: string
          title: string
        }[]
      }
      set_client_status: {
        Args: {
          p_actor: string
          p_client_id: string
          p_status: Database["public"]["Enums"]["client_status"]
        }
        Returns: {
          affiliate_id: string | null
          archived_at: string | null
          archived_by: string | null
          assigned_to: string | null
          business_name: string | null
          consumer_profile_id: string | null
          created_at: string
          display_name: string
          funded_amount_cents: number
          goal_cents: number | null
          id: string
          last_activity_at: string
          matches_unlocked_override: boolean
          org_id: string
          stage: Database["public"]["Enums"]["client_stage"]
          stage_entered_at: string
          started_at: string
          status: Database["public"]["Enums"]["client_status"]
        }[]
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_pull_cap: {
        Args: {
          p_actor: string
          p_client_id: string
          p_count_window_seconds: number
          p_max_count: number
          p_min_interval_seconds: number
        }
        Returns: {
          client_id: string
          count_window_seconds: number | null
          max_count: number | null
          min_interval_seconds: number | null
          org_id: string
          updated_at: string
          updated_by: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pull_caps"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_discard_draft: {
        Args: { p_actor_profile_id: string; p_draft_id: string }
        Returns: {
          body: string
          confidence: number
          confidence_threshold: number
          created_at: string
          discarded_at: string | null
          discarded_by: string | null
          driver: string
          guardrail_flags: string[]
          id: string
          model: string
          prompt_key: string
          prompt_version: number
          sent_at: string | null
          sent_by: string | null
          sent_message_id: string | null
          status: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved: boolean
          thread_id: string
        }
        SetofOptions: {
          from: "*"
          to: "held_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_list_messages: {
        Args: {
          p_actor_profile_id: string
          p_limit?: number
          p_thread_id: string
        }
        Returns: {
          author_kind: Database["public"]["Enums"]["support_author_kind"]
          author_profile_id: string
          body: string
          id: string
          origin: Database["public"]["Enums"]["support_message_origin"]
          origin_draft_id: string | null
          sent_at: string
          thread_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_list_threads: {
        Args: { p_actor_profile_id: string; p_limit?: number }
        Returns: {
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at: string
          org_id: string
          status: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_threads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_open_thread: {
        Args: {
          p_actor_profile_id: string
          p_client_id: string
          p_kind: Database["public"]["Enums"]["support_thread_kind"]
          p_org_id: string
          p_subject: string
        }
        Returns: {
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at: string
          org_id: string
          status: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }
        SetofOptions: {
          from: "*"
          to: "support_threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_read_open_draft: {
        Args: { p_actor_profile_id: string; p_thread_id: string }
        Returns: {
          body: string
          confidence: number
          confidence_threshold: number
          created_at: string
          discarded_at: string | null
          discarded_by: string | null
          driver: string
          guardrail_flags: string[]
          id: string
          model: string
          prompt_key: string
          prompt_version: number
          sent_at: string | null
          sent_by: string | null
          sent_message_id: string | null
          status: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved: boolean
          thread_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "held_drafts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_read_thread: {
        Args: { p_actor_profile_id: string; p_thread_id: string }
        Returns: {
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at: string
          org_id: string
          status: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_threads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_record_draft: {
        Args: {
          p_actor_profile_id: string
          p_body: string
          p_confidence: number
          p_confidence_threshold: number
          p_driver: string
          p_guardrail_flags: string[]
          p_model: string
          p_prompt_key: string
          p_prompt_version: number
          p_supervisor_approved: boolean
          p_thread_id: string
        }
        Returns: {
          body: string
          confidence: number
          confidence_threshold: number
          created_at: string
          discarded_at: string | null
          discarded_by: string | null
          driver: string
          guardrail_flags: string[]
          id: string
          model: string
          prompt_key: string
          prompt_version: number
          sent_at: string | null
          sent_by: string | null
          sent_message_id: string | null
          status: Database["public"]["Enums"]["held_draft_status"]
          supervisor_approved: boolean
          thread_id: string
        }
        SetofOptions: {
          from: "*"
          to: "held_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_send_message: {
        Args: {
          p_actor_profile_id: string
          p_author_kind: Database["public"]["Enums"]["support_author_kind"]
          p_body: string
          p_draft_id?: string
          p_thread_id: string
        }
        Returns: {
          author_kind: Database["public"]["Enums"]["support_author_kind"]
          author_profile_id: string
          body: string
          id: string
          origin: Database["public"]["Enums"]["support_message_origin"]
          origin_draft_id: string | null
          sent_at: string
          thread_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      support_set_thread_status: {
        Args: {
          p_actor_profile_id: string
          p_status: Database["public"]["Enums"]["support_thread_status"]
          p_thread_id: string
        }
        Returns: {
          client_id: string | null
          created_at: string
          created_by: string
          id: string
          kind: Database["public"]["Enums"]["support_thread_kind"]
          last_activity_at: string
          org_id: string
          status: Database["public"]["Enums"]["support_thread_status"]
          subject: string
        }
        SetofOptions: {
          from: "*"
          to: "support_threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tenancy_accept_invite: {
        Args: {
          p_email: string
          p_invite_id: string
          p_provider_user_id: string
          p_token_id: string
        }
        Returns: Json
      }
      tenancy_apply_org_action: {
        Args: {
          p_action: string
          p_actor_id: string
          p_org_id: string
          p_trial_ends_at: string
        }
        Returns: Json
      }
      tenancy_create_invite: {
        Args: {
          p_actor_id: string
          p_email: string
          p_expires_at: string
          p_full_name: string
          p_idempotency_key: string
          p_kind: string
          p_org_id: string
          p_org_role: string
        }
        Returns: Json
      }
      tenancy_deactivate_member: {
        Args: { p_actor_id: string; p_target_id: string }
        Returns: Json
      }
      tenancy_update_member_role: {
        Args: {
          p_actor_id: string
          p_org_role: Database["public"]["Enums"]["org_role"]
          p_target_id: string
        }
        Returns: Json
      }
      tenancy_email_registered_elsewhere: {
        Args: { p_actor_id: string; p_email: string }
        Returns: boolean
      }
      tenancy_expire_trials: { Args: { p_window: string }; Returns: Json }
      tenancy_mark_invite_delivery: {
        Args: {
          p_failure_code: string
          p_invite_id: string
          p_provider_user_id: string
          p_sent: boolean
        }
        Returns: Json
      }
      tenancy_provision_org: {
        Args: {
          p_actor_id: string
          p_email: string
          p_full_name: string
          p_idempotency_key: string
          p_name: string
          p_slug: string
          p_trial_ends_at: string
        }
        Returns: Json
      }
      tenancy_publish_brand: {
        Args: { p_actor_id: string; p_org_id: string }
        Returns: Json
      }
      tenancy_rename_org_slug: {
        Args: { p_actor_id: string; p_org_id: string; p_slug: string }
        Returns: Json
      }
      tenancy_update_brand: {
        Args: { p_actor_id: string; p_brand: Json; p_org_id: string }
        Returns: Json
      }
      tracker_client_health: {
        Args: {
          p_last_activity_at: string
          p_now?: string
          p_stage: Database["public"]["Enums"]["client_stage"]
          p_stage_entered_at: string
        }
        Returns: string
      }
      tracker_client_health_batch: {
        Args: { p_client_ids: string[]; p_now?: string }
        Returns: {
          client_id: string
          health: string
          health_rank: number
        }[]
      }
      tracker_transition_client_stage: {
        Args: {
          p_actor: string
          p_client_id: string
          p_event_key: string
          p_expected_from: Database["public"]["Enums"]["client_stage"]
          p_source: string
          p_to_stage: Database["public"]["Enums"]["client_stage"]
        }
        Returns: {
          current_stage: Database["public"]["Enums"]["client_stage"]
          result: string
          stage_entered_at: string
        }[]
      }
      unpublish_training:
        | {
            Args: { p_actor: string; p_id: string }
            Returns: {
              attestation_text: string | null
              attested: boolean
              attested_at: string | null
              audience: Database["public"]["Enums"]["training_audience"]
              body: string
              created_at: string
              created_by: string
              id: string
              org_id: string | null
              published: boolean
              published_at: string | null
              published_by: string | null
              source: Database["public"]["Enums"]["training_source"]
              source_file_name: string | null
              source_mime_type: string | null
              source_object_path: string | null
              source_size_bytes: number | null
              source_uploaded_at: string | null
              takedown_reason: string | null
              taken_down_at: string | null
              taken_down_by: string | null
              title: string
              updated_at: string
              video_url: string
            }[]
            SetofOptions: {
              from: "*"
              to: "trainings"
              isOneToOne: false
              isSetofReturn: true
            }
          }
        | {
            Args: { p_actor: string; p_id: string; p_reason: string }
            Returns: {
              attestation_text: string | null
              attested: boolean
              attested_at: string | null
              audience: Database["public"]["Enums"]["training_audience"]
              body: string
              created_at: string
              created_by: string
              id: string
              org_id: string | null
              published: boolean
              published_at: string | null
              published_by: string | null
              source: Database["public"]["Enums"]["training_source"]
              source_file_name: string | null
              source_mime_type: string | null
              source_object_path: string | null
              source_size_bytes: number | null
              source_uploaded_at: string | null
              takedown_reason: string | null
              taken_down_at: string | null
              taken_down_by: string | null
              title: string
              updated_at: string
              video_url: string
            }[]
            SetofOptions: {
              from: "*"
              to: "trainings"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      update_platform_training: {
        Args: {
          p_actor: string
          p_audience: Database["public"]["Enums"]["training_audience"]
          p_body: string
          p_id: string
          p_source_file_name: string
          p_source_mime_type: string
          p_source_size_bytes: number
          p_title: string
          p_video_url: string
        }
        Returns: {
          attestation_text: string | null
          attested: boolean
          attested_at: string | null
          audience: Database["public"]["Enums"]["training_audience"]
          body: string
          created_at: string
          created_by: string
          id: string
          org_id: string | null
          published: boolean
          published_at: string | null
          published_by: string | null
          source: Database["public"]["Enums"]["training_source"]
          source_file_name: string | null
          source_mime_type: string | null
          source_object_path: string | null
          source_size_bytes: number | null
          source_uploaded_at: string | null
          takedown_reason: string | null
          taken_down_at: string | null
          taken_down_by: string | null
          title: string
          updated_at: string
          video_url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trainings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_training: {
        Args: {
          p_actor: string
          p_audience: Database["public"]["Enums"]["training_audience"]
          p_body: string
          p_id: string
          p_title: string
          p_video_url: string
        }
        Returns: {
          attestation_text: string | null
          attested: boolean
          attested_at: string | null
          audience: Database["public"]["Enums"]["training_audience"]
          body: string
          created_at: string
          created_by: string
          id: string
          org_id: string | null
          published: boolean
          published_at: string | null
          published_by: string | null
          source: Database["public"]["Enums"]["training_source"]
          source_file_name: string | null
          source_mime_type: string | null
          source_object_path: string | null
          source_size_bytes: number | null
          source_uploaded_at: string | null
          takedown_reason: string | null
          taken_down_at: string | null
          taken_down_by: string | null
          title: string
          updated_at: string
          video_url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "trainings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      affiliate_payment_status: "not_ready" | "pending" | "submitted" | "paid"
      analysis_job_error_code:
        | "source_unavailable"
        | "pull_failed"
        | "plan_rejected"
        | "persistence_failed"
        | "tracker_failed"
        | "configuration_error"
      analysis_job_source_kind:
        | "enrollment"
        | "monitoring_event"
        | "document_upload"
        | "force_pull"
      analysis_job_status:
        | "queued"
        | "running"
        | "persisted"
        | "succeeded"
        | "failed"
        | "cancelled"
      analysis_trigger: "scheduled" | "alert" | "force_pull" | "upload"
      app_role: "platform_admin" | "operator_member" | "consumer" | "affiliate"
      application_consumer_status: "approved" | "pending" | "denied"
      application_note_author_kind: "consumer" | "operator"
      application_operator_status: "wait" | "todo"
      application_visibility: "inherit" | "details" | "status_only"
      assignment_mode: "manual" | "round_robin"
      background_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "skipped"
        | "failed"
      checklist_kind: "personal_credit" | "business_setup"
      checklist_state: "todo" | "reported" | "verifying" | "verified"
      client_stage:
        | "onboarding"
        | "optimization"
        | "ready"
        | "applying"
        | "funded"
        | "graduate"
      client_status: "active" | "archived"
      consent_action: "granted" | "revoked"
      consent_kind: "monitoring" | "analysis"
      crs_persona: "clean" | "derog" | "thin_file" | "no_hit"
      document_section:
        | "articles"
        | "ein"
        | "tax_returns"
        | "bank_statements"
        | "other"
      document_upload_kind: "company" | "credit_report"
      document_upload_lifecycle:
        | "pending"
        | "stored"
        | "parsed"
        | "delete_pending"
        | "purged"
        | "failed"
      email_outbox_status: "pending" | "accepted" | "failed"
      enrollment_milestone_kind:
        | "agreement_signed"
        | "documents_uploaded"
        | "monitoring_connected"
        | "onboarding_call_completed"
      enrollment_status: "enrolled" | "parked" | "active" | "cancelled"
      fee_agreement_status: "draft" | "active" | "void"
      fee_model: "percentage" | "package" | "custom"
      fee_payment_method: "bank_transfer" | "card" | "check" | "cash" | "other"
      held_draft_status: "draft" | "approved" | "sent" | "discarded"
      kb_import_status: "running" | "succeeded" | "failed"
      notification_delivery_channel: "in_app" | "email"
      notification_delivery_status:
        | "queued"
        | "running"
        | "delivered"
        | "failed"
      operator_subscription_status:
        | "trialing"
        | "active"
        | "incomplete"
        | "incomplete_expired"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "paused"
      org_membership: "trial" | "current" | "past_due" | "grace" | "deactivated"
      org_plan: "trial" | "pro" | "agency"
      org_role:
        | "owner"
        | "admin"
        | "prep_specialist"
        | "funding_specialist"
        | "commando"
        | "manager"
        | "member"
      outcome_job_status: "queued" | "running" | "succeeded" | "failed"
      outcome_kind: "approved" | "denied" | "withdrawn"
      outcome_notification_kind:
        | "outcome_review_approved"
        | "outcome_review_removed"
        | "crs_alert"
      outcome_review_state: "pending" | "approved" | "removed"
      outcome_state: "counted" | "removed"
      prompt_activation_hold_reason: "evaluation_evidence_missing"
      prompt_activation_status: "activated" | "held"
      pull_cap_reason: "minimum_interval" | "count_window"
      settlement_status: "accrued" | "exported" | "paid" | "reversed"
      support_author_kind: "consumer" | "operator" | "admin"
      support_message_origin: "human" | "ai_assisted"
      support_thread_kind: "team_chat" | "platform_support"
      support_thread_status: "open" | "pending" | "resolved"
      tenant_invite_kind: "team" | "affiliate" | "client"
      tenant_invite_status:
        | "pending"
        | "sent"
        | "failed"
        | "accepted"
        | "expired"
      training_audience: "client" | "operator"
      training_source: "operator" | "platform"
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
      affiliate_payment_status: ["not_ready", "pending", "submitted", "paid"],
      analysis_job_error_code: [
        "source_unavailable",
        "pull_failed",
        "plan_rejected",
        "persistence_failed",
        "tracker_failed",
        "configuration_error",
      ],
      analysis_job_source_kind: [
        "enrollment",
        "monitoring_event",
        "document_upload",
        "force_pull",
      ],
      analysis_job_status: [
        "queued",
        "running",
        "persisted",
        "succeeded",
        "failed",
        "cancelled",
      ],
      analysis_trigger: ["scheduled", "alert", "force_pull", "upload"],
      app_role: ["platform_admin", "operator_member", "consumer", "affiliate"],
      application_consumer_status: ["approved", "pending", "denied"],
      application_note_author_kind: ["consumer", "operator"],
      application_operator_status: ["wait", "todo"],
      application_visibility: ["inherit", "details", "status_only"],
      assignment_mode: ["manual", "round_robin"],
      background_job_status: [
        "queued",
        "running",
        "succeeded",
        "skipped",
        "failed",
      ],
      checklist_kind: ["personal_credit", "business_setup"],
      checklist_state: ["todo", "reported", "verifying", "verified"],
      client_stage: [
        "onboarding",
        "optimization",
        "ready",
        "applying",
        "funded",
        "graduate",
      ],
      client_status: ["active", "archived"],
      consent_action: ["granted", "revoked"],
      consent_kind: ["monitoring", "analysis"],
      crs_persona: ["clean", "derog", "thin_file", "no_hit"],
      document_section: [
        "articles",
        "ein",
        "tax_returns",
        "bank_statements",
        "other",
      ],
      document_upload_kind: ["company", "credit_report"],
      document_upload_lifecycle: [
        "pending",
        "stored",
        "parsed",
        "delete_pending",
        "purged",
        "failed",
      ],
      email_outbox_status: ["pending", "accepted", "failed"],
      enrollment_milestone_kind: [
        "agreement_signed",
        "documents_uploaded",
        "monitoring_connected",
        "onboarding_call_completed",
      ],
      enrollment_status: ["enrolled", "parked", "active", "cancelled"],
      fee_agreement_status: ["draft", "active", "void"],
      fee_model: ["percentage", "package", "custom"],
      fee_payment_method: ["bank_transfer", "card", "check", "cash", "other"],
      held_draft_status: ["draft", "approved", "sent", "discarded"],
      kb_import_status: ["running", "succeeded", "failed"],
      notification_delivery_channel: ["in_app", "email"],
      notification_delivery_status: [
        "queued",
        "running",
        "delivered",
        "failed",
      ],
      operator_subscription_status: [
        "trialing",
        "active",
        "incomplete",
        "incomplete_expired",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
      org_membership: ["trial", "current", "past_due", "grace", "deactivated"],
      org_plan: ["trial", "pro", "agency"],
      org_role: [
        "owner",
        "admin",
        "prep_specialist",
        "funding_specialist",
        "commando",
        "manager",
        "member",
      ],
      outcome_job_status: ["queued", "running", "succeeded", "failed"],
      outcome_kind: ["approved", "denied", "withdrawn"],
      outcome_notification_kind: [
        "outcome_review_approved",
        "outcome_review_removed",
        "crs_alert",
      ],
      outcome_review_state: ["pending", "approved", "removed"],
      outcome_state: ["counted", "removed"],
      prompt_activation_hold_reason: ["evaluation_evidence_missing"],
      prompt_activation_status: ["activated", "held"],
      pull_cap_reason: ["minimum_interval", "count_window"],
      settlement_status: ["accrued", "exported", "paid", "reversed"],
      support_author_kind: ["consumer", "operator", "admin"],
      support_message_origin: ["human", "ai_assisted"],
      support_thread_kind: ["team_chat", "platform_support"],
      support_thread_status: ["open", "pending", "resolved"],
      tenant_invite_kind: ["team", "affiliate", "client"],
      tenant_invite_status: [
        "pending",
        "sent",
        "failed",
        "accepted",
        "expired",
      ],
      training_audience: ["client", "operator"],
      training_source: ["operator", "platform"],
    },
  },
} as const
