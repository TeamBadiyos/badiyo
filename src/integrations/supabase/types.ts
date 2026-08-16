export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          area: string | null
          city: string | null
          created_at: string | null
          full_address: string
          id: string
          is_default: boolean | null
          label: string | null
          landmark_photo_url: string | null
          latitude: number | null
          longitude: number | null
          user_id: string | null
        }
        Insert: {
          area?: string | null
          city?: string | null
          created_at?: string | null
          full_address: string
          id?: string
          is_default?: boolean | null
          label?: string | null
          landmark_photo_url?: string | null
          latitude?: number | null
          longitude?: number | null
          user_id?: string | null
        }
        Update: {
          area?: string | null
          city?: string | null
          created_at?: string | null
          full_address?: string
          id?: string
          is_default?: boolean | null
          label?: string | null
          landmark_photo_url?: string | null
          latitude?: number | null
          longitude?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          current_version: string
          id: number
          min_supported_version: string
          updated_at: string
        }
        Insert: {
          current_version?: string
          id?: number
          min_supported_version?: string
          updated_at?: string
        }
        Update: {
          current_version?: string
          id?: number
          min_supported_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      area_partner_leads: {
        Row: {
          area: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string
          status: string
        }
        Insert: {
          area: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone: string
          status?: string
        }
        Update: {
          area?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string
          status?: string
        }
        Relationships: []
      }
      area_partners: {
        Row: {
          address: string | null
          bank_account_holder_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          commission_rate: number
          commission_type: string
          commission_value: number
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          kyc_aadhaar_url: string | null
          kyc_address_proof_url: string | null
          kyc_pan_url: string | null
          kyc_rejection_reason: string | null
          kyc_status: string
          name: string
          phone: string
          photo_url: string | null
          setup_fee_status: string
          status: string
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          commission_rate?: number
          commission_type?: string
          commission_value?: number
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          name: string
          phone: string
          photo_url?: string | null
          setup_fee_status?: string
          status?: string
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          commission_rate?: number
          commission_type?: string
          commission_value?: number
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          name?: string
          phone?: string
          photo_url?: string | null
          setup_fee_status?: string
          status?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "area_partners_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      booking_extensions: {
        Row: {
          approval_status: string
          booking_id: string
          created_at: string
          extra_minutes: number
          id: string
          price: number
          razorpay_payment_id: string | null
        }
        Insert: {
          approval_status?: string
          booking_id: string
          created_at?: string
          extra_minutes: number
          id?: string
          price: number
          razorpay_payment_id?: string | null
        }
        Update: {
          approval_status?: string
          booking_id?: string
          created_at?: string
          extra_minutes?: number
          id?: string
          price?: number
          razorpay_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_extensions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          broadcast_started_at: string | null
          cancellation_fee: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          current_search_radius_km: number | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          end_otp: string | null
          id: string
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number | null
          refund_id: string | null
          refund_status: string | null
          reminder_sent: boolean
          review_text: string | null
          scheduled_date: string | null
          scheduled_time_slot: string | null
          service_category_id: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          start_otp: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        Insert: {
          address_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          broadcast_started_at?: string | null
          cancellation_fee?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          current_search_radius_km?: number | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_otp?: string | null
          id?: string
          price: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number | null
          refund_id?: string | null
          refund_status?: string | null
          reminder_sent?: boolean
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_category_id?: string | null
          service_duration_minutes: number
          service_end_at?: string | null
          service_label: string
          slot_type: string
          start_otp?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Update: {
          address_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          broadcast_started_at?: string | null
          cancellation_fee?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string | null
          current_search_radius_km?: number | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_otp?: string | null
          id?: string
          price?: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number | null
          refund_id?: string | null
          refund_status?: string | null
          reminder_sent?: boolean
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_category_id?: string | null
          service_duration_minutes?: number
          service_end_at?: string | null
          service_label?: string
          slot_type?: string
          start_otp?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_assigned_expert_id_fkey"
            columns: ["assigned_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      business_interest_leads: {
        Row: {
          business_name: string | null
          category_interested: string
          city: string
          created_at: string
          id: string
          owner_name: string
          phone: string
        }
        Insert: {
          business_name?: string | null
          category_interested: string
          city?: string
          created_at?: string
          id?: string
          owner_name: string
          phone: string
        }
        Update: {
          business_name?: string | null
          category_interested?: string
          city?: string
          created_at?: string
          id?: string
          owner_name?: string
          phone?: string
        }
        Relationships: []
      }
      city_interest_leads: {
        Row: {
          city: string
          created_at: string
          id: string
          name: string
          phone: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          name: string
          phone: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string
        }
        Relationships: []
      }
      device_sessions: {
        Row: {
          created_at: string
          device_id: string
          device_label: string | null
          id: string
          last_active_at: string
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string
          device_id: string
          device_label?: string | null
          id?: string
          last_active_at?: string
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string
          device_id?: string
          device_label?: string | null
          id?: string
          last_active_at?: string
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          fcm_token: string
          id: string
          last_used_at: string
          platform: string
          updated_at: string
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string
          fcm_token: string
          id?: string
          last_used_at?: string
          platform: string
          updated_at?: string
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string
          fcm_token?: string
          id?: string
          last_used_at?: string
          platform?: string
          updated_at?: string
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      dispatch_config: {
        Row: {
          broadcast_radius_km: number
          broadcast_timeout_seconds: number
          city: string
          created_at: string
          id: string
          radius_expand_after_seconds: number
          radius_expand_max_km: number
          radius_expand_step_km: number
          updated_at: string
        }
        Insert: {
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          radius_expand_after_seconds?: number
          radius_expand_max_km?: number
          radius_expand_step_km?: number
          updated_at?: string
        }
        Update: {
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          radius_expand_after_seconds?: number
          radius_expand_max_km?: number
          radius_expand_step_km?: number
          updated_at?: string
        }
        Relationships: []
      }
      edge_runtime_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      emergency_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          booking_id: string | null
          created_at: string
          expert_id: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          expert_id: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_alerts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_alerts_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_leads: {
        Row: {
          area: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string
          status: string
        }
        Insert: {
          area: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone: string
          status?: string
        }
        Update: {
          area?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string
          status?: string
        }
        Relationships: []
      }
      experts: {
        Row: {
          address: string | null
          approved_by: string | null
          auth_user_id: string | null
          bank_account_holder_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          id: string
          is_busy: boolean
          is_online: boolean
          kyc_aadhaar_url: string | null
          kyc_address_proof_url: string | null
          kyc_pan_url: string | null
          kyc_rejection_reason: string | null
          kyc_status: string
          level: string
          location_updated_at: string | null
          name: string
          onboarded_by: string | null
          phone: string
          photo_url: string | null
          pin_hash: string | null
          preferred_language: string
          security_deposit_status: string
          status: string
          wallet_balance: number
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_busy?: boolean
          is_online?: boolean
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          level?: string
          location_updated_at?: string | null
          name: string
          onboarded_by?: string | null
          phone: string
          photo_url?: string | null
          pin_hash?: string | null
          preferred_language?: string
          security_deposit_status?: string
          status?: string
          wallet_balance?: number
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_busy?: boolean
          is_online?: boolean
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          level?: string
          location_updated_at?: string | null
          name?: string
          onboarded_by?: string | null
          phone?: string
          photo_url?: string | null
          pin_hash?: string | null
          preferred_language?: string
          security_deposit_status?: string
          status?: string
          wallet_balance?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experts_onboarded_by_fkey"
            columns: ["onboarded_by"]
            isOneToOne: false
            referencedRelation: "area_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      homepage_sections: {
        Row: {
          city_id: string | null
          display_order: number
          is_active: boolean | null
          payload: Json
          section_id: string
          section_type: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          city_id?: string | null
          display_order?: number
          is_active?: boolean | null
          payload: Json
          section_id?: string
          section_type: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          city_id?: string | null
          display_order?: number
          is_active?: boolean | null
          payload?: Json
          section_id?: string
          section_type?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      legal_pages: {
        Row: {
          content: string
          effective_date: string | null
          id: string
          is_active: boolean
          last_updated_at: string
          slug: string
          title: string
          updated_by: string | null
        }
        Insert: {
          content: string
          effective_date?: string | null
          id?: string
          is_active?: boolean
          last_updated_at?: string
          slug: string
          title: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          effective_date?: string | null
          id?: string
          is_active?: boolean
          last_updated_at?: string
          slug?: string
          title?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_pages_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_documents: {
        Row: {
          doc_type: string
          file_url: string
          id: string
          merchant_id: string
          uploaded_at: string
        }
        Insert: {
          doc_type: string
          file_url: string
          id?: string
          merchant_id: string
          uploaded_at?: string
        }
        Update: {
          doc_type?: string
          file_url?: string
          id?: string
          merchant_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_documents_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_fee_tiers: {
        Row: {
          id: string
          is_active: boolean
          monthly_fee: number
          name: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          monthly_fee: number
          name: string
        }
        Update: {
          id?: string
          is_active?: boolean
          monthly_fee?: number
          name?: string
        }
        Relationships: []
      }
      merchant_order_items: {
        Row: {
          id: string
          order_id: string
          price_snapshot: number
          product_id: string
          product_name_snapshot: string
          quantity: number
        }
        Insert: {
          id?: string
          order_id: string
          price_snapshot: number
          product_id: string
          product_name_snapshot: string
          quantity?: number
        }
        Update: {
          id?: string
          order_id?: string
          price_snapshot?: number
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "merchant_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "merchant_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_orders: {
        Row: {
          commission_amount: number | null
          created_at: string
          id: string
          merchant_id: string
          order_number: string
          status: string
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          commission_amount?: number | null
          created_at?: string
          id?: string
          merchant_id: string
          order_number: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          commission_amount?: number | null
          created_at?: string
          id?: string
          merchant_id?: string
          order_number?: string
          status?: string
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_orders_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_roles: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          merchant_id: string
          name: string
          permissions: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          merchant_id: string
          name: string
          permissions?: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          merchant_id?: string
          name?: string
          permissions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "merchant_roles_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_schedule_overrides: {
        Row: {
          id: string
          is_closed: boolean
          merchant_id: string
          note: string | null
          override_date: string
        }
        Insert: {
          id?: string
          is_closed?: boolean
          merchant_id: string
          note?: string | null
          override_date: string
        }
        Update: {
          id?: string
          is_closed?: boolean
          merchant_id?: string
          note?: string | null
          override_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_schedule_overrides_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_staff: {
        Row: {
          auth_user_id: string | null
          created_at: string
          id: string
          merchant_id: string
          name: string | null
          phone: string
          role_id: string | null
          status: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          id?: string
          merchant_id: string
          name?: string | null
          phone: string
          role_id?: string | null
          status?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          id?: string
          merchant_id?: string
          name?: string | null
          phone?: string
          role_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_staff_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_staff_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "merchant_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_store_hours: {
        Row: {
          close_time: string | null
          day_of_week: number
          id: string
          is_closed: boolean
          merchant_id: string
          open_time: string | null
        }
        Insert: {
          close_time?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean
          merchant_id: string
          open_time?: string | null
        }
        Update: {
          close_time?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean
          merchant_id?: string
          open_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_store_hours_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_subscription_invoices: {
        Row: {
          amount: number
          billing_month: string
          created_at: string
          fee_tier_id: string | null
          id: string
          merchant_id: string
          paid_at: string | null
          status: string
        }
        Insert: {
          amount: number
          billing_month: string
          created_at?: string
          fee_tier_id?: string | null
          id?: string
          merchant_id: string
          paid_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          billing_month?: string
          created_at?: string
          fee_tier_id?: string | null
          id?: string
          merchant_id?: string
          paid_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_subscription_invoices_fee_tier_id_fkey"
            columns: ["fee_tier_id"]
            isOneToOne: false
            referencedRelation: "merchant_fee_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_subscription_invoices_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          address: string | null
          approved_at: string | null
          approved_by: string | null
          auth_user_id: string | null
          bank_account_holder_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          city: string | null
          commission_type: string
          commission_value: number
          country: string | null
          created_at: string
          delivery_fee_payer: string
          fee_tier_id: string | null
          fulfillment_mode: string
          gst_legal_name: string | null
          gst_status: string | null
          gstin: string | null
          id: string
          is_accepting_orders: boolean
          is_gst_registered: boolean | null
          latitude: number | null
          longitude: number | null
          onboarded_by: string | null
          onboarding_step: number
          owner_name: string | null
          pan: string | null
          phone: string
          pin_hash: string | null
          pincode: string | null
          segment_id: string | null
          shop_photo_url: string | null
          state: string | null
          status: string
          store_category_id: string | null
          store_hours: Json | null
          store_name: string | null
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          city?: string | null
          commission_type?: string
          commission_value?: number
          country?: string | null
          created_at?: string
          delivery_fee_payer?: string
          fee_tier_id?: string | null
          fulfillment_mode?: string
          gst_legal_name?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          is_accepting_orders?: boolean
          is_gst_registered?: boolean | null
          latitude?: number | null
          longitude?: number | null
          onboarded_by?: string | null
          onboarding_step?: number
          owner_name?: string | null
          pan?: string | null
          phone: string
          pin_hash?: string | null
          pincode?: string | null
          segment_id?: string | null
          shop_photo_url?: string | null
          state?: string | null
          status?: string
          store_category_id?: string | null
          store_hours?: Json | null
          store_name?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          approved_by?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          city?: string | null
          commission_type?: string
          commission_value?: number
          country?: string | null
          created_at?: string
          delivery_fee_payer?: string
          fee_tier_id?: string | null
          fulfillment_mode?: string
          gst_legal_name?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          is_accepting_orders?: boolean
          is_gst_registered?: boolean | null
          latitude?: number | null
          longitude?: number | null
          onboarded_by?: string | null
          onboarding_step?: number
          owner_name?: string | null
          pan?: string | null
          phone?: string
          pin_hash?: string | null
          pincode?: string | null
          segment_id?: string | null
          shop_photo_url?: string | null
          state?: string | null
          status?: string
          store_category_id?: string | null
          store_hours?: Json | null
          store_name?: string | null
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchants_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchants_fee_tier_id_fkey"
            columns: ["fee_tier_id"]
            isOneToOne: false
            referencedRelation: "merchant_fee_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchants_onboarded_by_fkey"
            columns: ["onboarded_by"]
            isOneToOne: false
            referencedRelation: "area_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchants_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchants_store_category_id_fkey"
            columns: ["store_category_id"]
            isOneToOne: false
            referencedRelation: "store_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchants_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_sounds: {
        Row: {
          applies_to: string[]
          audio_url: string | null
          event_key: string
          id: string
          is_active: boolean
          label: string
          updated_at: string
        }
        Insert: {
          applies_to: string[]
          audio_url?: string | null
          event_key: string
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
        }
        Update: {
          applies_to?: string[]
          audio_url?: string | null
          event_key?: string
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
        }
        Relationships: []
      }
      offline_sale_items: {
        Row: {
          gst_rate: number
          hsn_sac_snapshot: string | null
          id: string
          price_snapshot: number
          product_id: string
          product_name_snapshot: string
          quantity: number
          sale_id: string
        }
        Insert: {
          gst_rate?: number
          hsn_sac_snapshot?: string | null
          id?: string
          price_snapshot: number
          product_id: string
          product_name_snapshot: string
          quantity: number
          sale_id: string
        }
        Update: {
          gst_rate?: number
          hsn_sac_snapshot?: string | null
          id?: string
          price_snapshot?: number
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sales: {
        Row: {
          amount_due: number
          cgst_amount: number
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          discount_amount: number
          id: string
          invoice_number: string
          merchant_id: string
          payment_mode_id: string
          payment_status: string
          sgst_amount: number
          subtotal: number
          total_amount: number
        }
        Insert: {
          amount_due?: number
          cgst_amount?: number
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          invoice_number: string
          merchant_id: string
          payment_mode_id: string
          payment_status?: string
          sgst_amount?: number
          subtotal: number
          total_amount: number
        }
        Update: {
          amount_due?: number
          cgst_amount?: number
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          invoice_number?: string
          merchant_id?: string
          payment_mode_id?: string
          payment_status?: string
          sgst_amount?: number
          subtotal?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "offline_sales_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sales_payment_mode_id_fkey"
            columns: ["payment_mode_id"]
            isOneToOne: false
            referencedRelation: "payment_modes"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          code: string
          created_at: string | null
          expires_at: string
          id: string
          is_verified: boolean | null
          phone: string
        }
        Insert: {
          code: string
          created_at?: string | null
          expires_at: string
          id?: string
          is_verified?: boolean | null
          phone: string
        }
        Update: {
          code?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          is_verified?: boolean | null
          phone?: string
        }
        Relationships: []
      }
      otp_rate_limits: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      partner_skills: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          expert_id: string
          id: string
          service_category_id: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          expert_id: string
          id?: string
          service_category_id: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          service_category_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_skills_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_skills_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_skills_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_modes: {
        Row: {
          id: string
          is_active: boolean
          is_credit_type: boolean
          name: string
        }
        Insert: {
          id?: string
          is_active?: boolean
          is_credit_type?: boolean
          name: string
        }
        Update: {
          id?: string
          is_active?: boolean
          is_credit_type?: boolean
          name?: string
        }
        Relationships: []
      }
      payout_batch_items: {
        Row: {
          amount: number
          batch_id: string
          booking_ids: string[]
          created_at: string
          id: string
          ledger_ids: string[]
          owner_id: string
          owner_type: string
          paid: boolean
          paid_at: string | null
        }
        Insert: {
          amount?: number
          batch_id: string
          booking_ids?: string[]
          created_at?: string
          id?: string
          ledger_ids?: string[]
          owner_id: string
          owner_type: string
          paid?: boolean
          paid_at?: string | null
        }
        Update: {
          amount?: number
          batch_id?: string
          booking_ids?: string[]
          created_at?: string
          id?: string
          ledger_ids?: string[]
          owner_id?: string
          owner_type?: string
          paid?: boolean
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          batch_type: string
          created_at: string
          id: string
          paid_at: string | null
          status: string
          total_amount: number
          week_end: string
          week_start: string
        }
        Insert: {
          batch_type?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          status?: string
          total_amount?: number
          week_end: string
          week_start: string
        }
        Update: {
          batch_type?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          status?: string
          total_amount?: number
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      pin_login_lockouts: {
        Row: {
          failed_attempts: number
          locked_until: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          failed_attempts?: number
          locked_until?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          failed_attempts?: number
          locked_until?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category_label: string | null
          created_at: string
          description: string | null
          gst_rate: number | null
          hsn_sac_code: string | null
          id: string
          image_url: string | null
          is_active: boolean
          low_stock_threshold: number
          merchant_id: string
          name: string
          price: number
          stock_quantity: number
          unit: string | null
        }
        Insert: {
          category_label?: string | null
          created_at?: string
          description?: string | null
          gst_rate?: number | null
          hsn_sac_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          merchant_id: string
          name: string
          price: number
          stock_quantity?: number
          unit?: string | null
        }
        Update: {
          category_label?: string | null
          created_at?: string
          description?: string | null
          gst_rate?: number | null
          hsn_sac_code?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          merchant_id?: string
          name?: string
          price?: number
          stock_quantity?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_config: {
        Row: {
          id: string
          is_active: boolean
          milestone_referrals: number | null
          milestone_reward_coins: number | null
          reward_coins: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean
          milestone_referrals?: number | null
          milestone_reward_coins?: number | null
          reward_coins?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean
          milestone_referrals?: number | null
          milestone_reward_coins?: number | null
          reward_coins?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      referral_transactions: {
        Row: {
          booking_id: string | null
          created_at: string | null
          id: string
          referred_user_id: string | null
          referrer_id: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reward_amount: number | null
          reward_date: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          referred_user_id?: string | null
          referrer_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reward_amount?: number | null
          reward_date?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          referred_user_id?: string | null
          referrer_id?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reward_amount?: number | null
          reward_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_transactions_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_transactions_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      segments: {
        Row: {
          created_at: string
          display_template: string
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          rank: number
          short_name: string | null
          slug: string
          updated_at: string
          vertical_type: string
        }
        Insert: {
          created_at?: string
          display_template: string
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          rank?: number
          short_name?: string | null
          slug: string
          updated_at?: string
          vertical_type: string
        }
        Update: {
          created_at?: string
          display_template?: string
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rank?: number
          short_name?: string | null
          slug?: string
          updated_at?: string
          vertical_type?: string
        }
        Relationships: []
      }
      service_catalogue_config: {
        Row: {
          area_partner_payout: number | null
          created_at: string | null
          display_order: number | null
          duration_label: string
          duration_minutes: number
          expert_payout: number | null
          hq_revenue: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          price: number
          service_category_id: string | null
          subtitle: string | null
        }
        Insert: {
          area_partner_payout?: number | null
          created_at?: string | null
          display_order?: number | null
          duration_label: string
          duration_minutes: number
          expert_payout?: number | null
          hq_revenue?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          price: number
          service_category_id?: string | null
          subtitle?: string | null
        }
        Update: {
          area_partner_payout?: number | null
          created_at?: string | null
          display_order?: number | null
          duration_label?: string
          duration_minutes?: number
          expert_payout?: number | null
          hq_revenue?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          price?: number
          service_category_id?: string | null
          subtitle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_catalogue_config_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          rank: number
          segment_id: string
          slug: string
        }
        Insert: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          rank?: number
          segment_id: string
          slug: string
        }
        Update: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rank?: number
          segment_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      service_task_details: {
        Row: {
          excluded_items: string[]
          icon_url: string | null
          id: string
          included_items: string[]
          is_active: boolean
          rank: number
          segment_id: string
          task_name: string
          task_slug: string
        }
        Insert: {
          excluded_items: string[]
          icon_url?: string | null
          id?: string
          included_items: string[]
          is_active?: boolean
          rank?: number
          segment_id: string
          task_name: string
          task_slug: string
        }
        Update: {
          excluded_items?: string[]
          icon_url?: string | null
          id?: string
          included_items?: string[]
          is_active?: boolean
          rank?: number
          segment_id?: string
          task_name?: string
          task_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_task_details_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          id: string
          name: string
          role: string
          status: string
          zone_id: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          name: string
          role: string
          status?: string
          zone_id?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          status?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      store_categories: {
        Row: {
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          rank: number
          segment_id: string
          slug: string
        }
        Insert: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          rank?: number
          segment_id: string
          slug: string
        }
        Update: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rank?: number
          segment_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_categories_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
      support_inquiries: {
        Row: {
          contact: string
          created_at: string
          id: string
          message: string
          name: string
          status: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          message: string
          name: string
          status?: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          message?: string
          name?: string
          status?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          message: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          notification_preferences: Json
          phone: string | null
          pin_hash: string | null
          preferred_language: string
          referral_code: string | null
          referral_count: number | null
          referred_by: string | null
          successful_referrals: number | null
          total_coins_earned: number | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          notification_preferences?: Json
          phone?: string | null
          pin_hash?: string | null
          preferred_language?: string
          referral_code?: string | null
          referral_count?: number | null
          referred_by?: string | null
          successful_referrals?: number | null
          total_coins_earned?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          notification_preferences?: Json
          phone?: string | null
          pin_hash?: string | null
          preferred_language?: string
          referral_code?: string | null
          referral_count?: number | null
          referred_by?: string | null
          successful_referrals?: number | null
          total_coins_earned?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      waitlist_requests: {
        Row: {
          address_text: string | null
          city: string | null
          created_at: string
          id: string
          latitude: number
          longitude: number
          segment_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          address_text?: string | null
          city?: string | null
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          segment_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          address_text?: string | null
          city?: string | null
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          segment_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_requests_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          owner_id: string
          owner_type: string
          reason: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          owner_id: string
          owner_type: string
          reason: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          owner_id?: string
          owner_type?: string
          reason?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      zones: {
        Row: {
          assigned_area_partner_id: string | null
          boundary: Json
          city: string
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          segment_id: string
          status: string
        }
        Insert: {
          assigned_area_partner_id?: string | null
          boundary: Json
          city: string
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          segment_id: string
          status?: string
        }
        Update: {
          assigned_area_partner_id?: string | null
          boundary?: Json
          city?: string
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          segment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_assigned_area_partner_fk"
            columns: ["assigned_area_partner_id"]
            isOneToOne: false
            referencedRelation: "area_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zones_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "segments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_booking_status: {
        Args: { _booking_id: string; _new_status: string }
        Returns: undefined
      }
      broadcast_booking_to_experts: {
        Args: { _booking_id: string; _radius?: number }
        Returns: number
      }
      check_serviceability: {
        Args: { _lat: number; _lng: number; _segment_id?: string }
        Returns: Json
      }
      claim_booking_as_expert: {
        Args: { p_booking_id: string }
        Returns: {
          address_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          broadcast_started_at: string | null
          cancellation_fee: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string | null
          current_search_radius_km: number | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          end_otp: string | null
          id: string
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number | null
          refund_id: string | null
          refund_status: string | null
          reminder_sent: boolean
          review_text: string | null
          scheduled_date: string | null
          scheduled_time_slot: string | null
          service_category_id: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          start_otp: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credit_referral_for_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      current_merchant_id: { Args: never; Returns: string }
      customer_cancel_booking_apply: {
        Args: {
          _booking_id: string
          _cancellation_fee: number
          _refund_amount: number
          _refund_id: string
          _refund_status: string
        }
        Returns: Json
      }
      customer_list_devices: { Args: never; Returns: Json }
      customer_register_device: {
        Args: { _device_id: string; _device_label?: string }
        Returns: Json
      }
      customer_revoke_device: {
        Args: { _device_id: string }
        Returns: undefined
      }
      customer_set_language: { Args: { _lang: string }; Returns: undefined }
      ensure_start_otp: { Args: { _booking_id: string }; Returns: string }
      expand_stale_broadcasts: { Args: never; Returns: number }
      expert_ensure_booking_codes: {
        Args: { _booking_id: string }
        Returns: {
          end_otp: string
          start_otp: string
        }[]
      }
      expert_register_device: {
        Args: { _device_id: string; _device_label?: string }
        Returns: Json
      }
      expert_reject_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      expert_request_skill: {
        Args: { _service_category_id: string }
        Returns: string
      }
      expert_revoke_device: { Args: { _device_id: string }; Returns: undefined }
      expert_set_language: { Args: { _lang: string }; Returns: undefined }
      expert_set_online: { Args: { _online: boolean }; Returns: undefined }
      expert_update_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      expert_update_photo_url: { Args: { _url: string }; Returns: undefined }
      expert_verify_end_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: number
      }
      expert_verify_start_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: string
      }
      extend_booking: {
        Args: {
          _booking_id: string
          _extra_minutes: number
          _razorpay_payment_id?: string
        }
        Returns: Json
      }
      generate_offline_invoice_number: {
        Args: { _merchant_id: string }
        Returns: string
      }
      generate_otp4: { Args: never; Returns: string }
      get_assigned_expert_public: {
        Args: { _booking_id: string }
        Returns: {
          id: string
          level: string
          name: string
          phone: string
          photo_url: string
          status: string
          zone_id: string
        }[]
      }
      get_auth_user_id_by_email: { Args: { _email: string }; Returns: string }
      get_auth_user_id_by_phone: { Args: { _phone: string }; Returns: string }
      get_broadcast_booking_address: {
        Args: { p_booking_id: string }
        Returns: {
          area: string
          city: string
          full_address: string
          landmark_photo_url: string
          latitude: number
          longitude: number
        }[]
      }
      get_broadcast_radius_km: { Args: never; Returns: number }
      get_eligible_experts_for_booking: {
        Args: { p_booking_id: string }
        Returns: {
          distance_km: number
          expert_id: string
        }[]
      }
      get_expert_id_for_auth: { Args: { _auth_uid: string }; Returns: string }
      has_login_pin: { Args: { p_phone: string }; Returns: boolean }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_active_staff: {
        Args: { _roles: string[]; _uid: string }
        Returns: boolean
      }
      is_public_product_image: {
        Args: { _object_name: string }
        Returns: boolean
      }
      link_referral: { Args: { _code: string }; Returns: undefined }
      merchant_advance_order: {
        Args: { _new_status: string; _order_id: string }
        Returns: undefined
      }
      merchant_claim_staff_invite: { Args: never; Returns: string }
      merchant_create_offline_sale: {
        Args: { _payload: Json }
        Returns: string
      }
      merchant_decide_order: {
        Args: { _decision: string; _order_id: string }
        Returns: undefined
      }
      merchant_ensure_draft: { Args: { _phone: string }; Returns: string }
      merchant_has_login_pin: { Args: { p_phone: string }; Returns: boolean }
      merchant_is_currently_open: {
        Args: { _merchant_id: string }
        Returns: boolean
      }
      merchant_my_context: { Args: never; Returns: Json }
      merchant_set_accepting_orders: {
        Args: { _accepting: boolean }
        Returns: boolean
      }
      merchant_set_login_pin: { Args: { p_pin: string }; Returns: undefined }
      merchant_submit_application: { Args: never; Returns: undefined }
      merchant_verify_pin_internal: {
        Args: { p_phone: string; p_pin: string }
        Returns: Json
      }
      notify_customer_alert: {
        Args: {
          _alert_type: string
          _body: string
          _booking_id: string
          _data?: Json
          _title: string
        }
        Returns: undefined
      }
      notify_customer_push: {
        Args: {
          _body: string
          _booking_id: string
          _route: string
          _title: string
        }
        Returns: undefined
      }
      notify_expert_alert: {
        Args: {
          _alert_type: string
          _body: string
          _data?: Json
          _expert_id: string
          _title: string
        }
        Returns: undefined
      }
      notify_expert_broadcast: {
        Args: {
          _body: string
          _booking_id: string
          _expert_id: string
          _title: string
        }
        Returns: undefined
      }
      notify_expert_push: {
        Args: {
          _body: string
          _expert_id: string
          _route: string
          _title: string
        }
        Returns: undefined
      }
      notify_push_event: {
        Args: {
          _alert_type: string
          _body: string
          _data?: Json
          _title: string
          _user_id: string
          _user_type: string
        }
        Returns: undefined
      }
      partner_decide_extension: {
        Args: { _decision: string; _extension_id: string }
        Returns: Json
      }
      point_in_polygon: {
        Args: { _lat: number; _lng: number; _poly: Json }
        Returns: boolean
      }
      register_device_token: {
        Args: { p_fcm_token: string; p_platform: string }
        Returns: string
      }
      resolve_caller_identity: {
        Args: { _auth_uid: string }
        Returns: {
          user_id: string
          user_type: string
        }[]
      }
      resolve_zone_for_point: {
        Args: { _lat: number; _lng: number }
        Returns: string
      }
      send_completion_reminders: { Args: never; Returns: number }
      set_login_pin: { Args: { p_pin: string }; Returns: undefined }
      staff_accept_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      staff_acknowledge_emergency_alert: {
        Args: { _alert_id: string; _notes?: string }
        Returns: undefined
      }
      staff_area_partner_kyc_decision: {
        Args: { _decision: string; _partner_id: string; _reason: string }
        Returns: undefined
      }
      staff_assign_area_partner: {
        Args: { _partner_id: string; _zone_id: string }
        Returns: undefined
      }
      staff_assign_expert: {
        Args: { _booking_id: string; _expert_id: string }
        Returns: undefined
      }
      staff_cancel_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_create_service_catalogue_row: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_decide_merchant: {
        Args: { _decision: string; _merchant_id: string; _notes?: string }
        Returns: undefined
      }
      staff_decide_partner_skill: {
        Args: { _decision: string; _notes?: string; _skill_id: string }
        Returns: undefined
      }
      staff_delete_service_catalogue_row: {
        Args: { _id: string }
        Returns: undefined
      }
      staff_delete_task_detail: { Args: { _id: string }; Returns: undefined }
      staff_edit_booking: {
        Args: { _booking_id: string; _payload: Json }
        Returns: undefined
      }
      staff_expert_kyc_decision: {
        Args: { _decision: string; _expert_id: string; _reason: string }
        Returns: undefined
      }
      staff_generate_merchant_payout_batch: { Args: never; Returns: string }
      staff_generate_payout_batch: { Args: never; Returns: string }
      staff_generate_subscription_invoices: { Args: never; Returns: Json }
      staff_mark_payout_batch_paid: {
        Args: { _batch_id: string }
        Returns: undefined
      }
      staff_mark_payout_item_paid: {
        Args: { _item_id: string; _paid: boolean }
        Returns: undefined
      }
      staff_mark_subscription_invoice_paid: {
        Args: { _invoice_id: string; _paid: boolean }
        Returns: undefined
      }
      staff_reassign_expert: {
        Args: { _booking_id: string; _new_expert_id: string }
        Returns: undefined
      }
      staff_redraw_zone_boundary: {
        Args: { _boundary: Json; _zone_id: string }
        Returns: undefined
      }
      staff_reject_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_reorder_homepage_sections: {
        Args: { _orders: Json }
        Returns: undefined
      }
      staff_reorder_task_details: {
        Args: { _orders: Json }
        Returns: undefined
      }
      staff_reverse_referral_reward: {
        Args: { _reason: string; _txn_id: string }
        Returns: undefined
      }
      staff_set_homepage_section_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      staff_set_merchant_fee_tier: {
        Args: { _fee_tier_id: string; _merchant_id: string }
        Returns: undefined
      }
      staff_soft_delete_area_partner: {
        Args: { _partner_id: string; _reason: string }
        Returns: undefined
      }
      staff_soft_delete_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_soft_delete_zone: {
        Args: { _reason: string; _zone_id: string }
        Returns: undefined
      }
      staff_update_booking_status: {
        Args: { _booking_id: string; _new_status: string; _note?: string }
        Returns: undefined
      }
      staff_update_referral_config: {
        Args: { _is_active: boolean; _reward: number }
        Returns: undefined
      }
      staff_update_service_price: {
        Args: { _id: string; _payload: Json }
        Returns: undefined
      }
      staff_update_zone: {
        Args: { _payload: Json; _zone_id: string }
        Returns: undefined
      }
      staff_upsert_area_partner: { Args: { _payload: Json }; Returns: string }
      staff_upsert_expert: { Args: { _payload: Json }; Returns: string }
      staff_upsert_fee_tier: { Args: { _payload: Json }; Returns: string }
      staff_upsert_homepage_section: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_upsert_legal_page: { Args: { _payload: Json }; Returns: string }
      staff_upsert_notification_sound: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_upsert_task_detail: { Args: { _payload: Json }; Returns: string }
      staff_verify_end_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: undefined
      }
      staff_verify_start_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: undefined
      }
      staff_wallet_adjust: {
        Args: {
          _amount: number
          _owner_id: string
          _owner_type: string
          _reason: string
          _type: string
        }
        Returns: string
      }
      start_service: { Args: { _booking_id: string }; Returns: string }
      submit_booking_review: {
        Args: { _booking_id: string; _rating: number; _review: string }
        Returns: undefined
      }
      system_accept_booking_after_payment: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      verify_login_pin: {
        Args: { p_phone: string; p_pin: string; p_user_type: string }
        Returns: {
          auth_user_id: string
          retry_after_seconds: number
          status: string
        }[]
      }
      verify_login_pin_internal: {
        Args: { p_phone: string; p_pin: string }
        Returns: Json
      }
      zone_delete_impact: { Args: { _zone_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
