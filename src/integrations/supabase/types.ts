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
      account_deletion_requests: {
        Row: {
          account_type: string
          created_at: string
          email: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          phone: string
          reason: string | null
          staff_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_type?: string
          created_at?: string
          email?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          phone: string
          reason?: string | null
          staff_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          created_at?: string
          email?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          phone?: string
          reason?: string | null
          staff_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_deletion_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
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
          pincode: string | null
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
          pincode?: string | null
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
          pincode?: string | null
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
      admin_alert_dispatch_state: {
        Row: {
          id: boolean
          last_dispatch_at: string
        }
        Insert: {
          id?: boolean
          last_dispatch_at?: string
        }
        Update: {
          id?: boolean
          last_dispatch_at?: string
        }
        Relationships: []
      }
      admin_alert_log: {
        Row: {
          created_at: string
          error: string | null
          id: string
          order_id: string
          order_type: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          order_id: string
          order_type: string
          status: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          order_id?: string
          order_type?: string
          status?: string
        }
        Relationships: []
      }
      admin_alert_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          order_id: string
          order_type: string
          sent_at: string | null
          status: string
          updated_at: string
          v_amount: string
          v_customer: string
          v_order: string
          v_time: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          order_id: string
          order_type: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          v_amount?: string
          v_customer?: string
          v_order?: string
          v_time?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string
          order_type?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          v_amount?: string
          v_customer?: string
          v_order?: string
          v_time?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          current_version: string
          id: number
          latest_version_code: number
          min_supported_version: string
          min_supported_version_code: number
          play_store_url: string | null
          updated_at: string
        }
        Insert: {
          current_version?: string
          id?: number
          latest_version_code?: number
          min_supported_version?: string
          min_supported_version_code?: number
          play_store_url?: string | null
          updated_at?: string
        }
        Update: {
          current_version?: string
          id?: number
          latest_version_code?: number
          min_supported_version?: string
          min_supported_version_code?: number
          play_store_url?: string | null
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
          pan_encrypted: string | null
          pan_last4: string | null
          pan_updated_at: string | null
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
          pan_encrypted?: string | null
          pan_last4?: string | null
          pan_updated_at?: string | null
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
          pan_encrypted?: string | null
          pan_last4?: string | null
          pan_updated_at?: string | null
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
      availability_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_unavailable: boolean
          reason: string | null
          target_id: string
          target_type: string
          unavailable_from: string | null
          unavailable_until: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_unavailable?: boolean
          reason?: string | null
          target_id: string
          target_type: string
          unavailable_from?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_unavailable?: boolean
          reason?: string | null
          target_id?: string
          target_type?: string
          unavailable_from?: string | null
          unavailable_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
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
      booking_preferred_experts: {
        Row: {
          booking_id: string
          created_at: string
          expert_id: string
          expires_at: string
          id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          expert_id: string
          expires_at: string
          id?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          expert_id?: string
          expires_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_preferred_experts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_preferred_experts_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_tips: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          expert_id: string | null
          id: string
          razorpay_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          expert_id?: string | null
          id?: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          expert_id?: string | null
          id?: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_tips_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_tips_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address_id: string | null
          assigned_area_partner_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          broadcast_started_at: string | null
          cancellation_fee: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission_rule_id: string | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string | null
          current_search_radius_km: number | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number
          dispatch_alert_sent: boolean
          dispatch_exhausted_at: string | null
          end_otp: string | null
          expert_payout_batch_id: string | null
          gst_amount: number
          gst_percent: number
          id: string
          last_rebroadcast_at: string | null
          partner_payout_batch_id: string | null
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number | null
          refund_attempts: number
          refund_error: string | null
          refund_id: string | null
          refund_next_attempt_at: string | null
          refund_status: string | null
          reminder_sent: boolean
          review_text: string | null
          scheduled_date: string | null
          scheduled_reminder_sent: boolean
          scheduled_time_slot: string | null
          service_category_id: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          snapshot_expert_payout: number | null
          snapshot_hourly_rate: number | null
          snapshot_hq_share: number | null
          snapshot_partner_payout: number | null
          start_otp: string | null
          started_at: string | null
          status: string
          total_amount: number
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        Insert: {
          address_id?: string | null
          assigned_area_partner_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          broadcast_started_at?: string | null
          cancellation_fee?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission_rule_id?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string | null
          current_search_radius_km?: number | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          dispatch_alert_sent?: boolean
          dispatch_exhausted_at?: string | null
          end_otp?: string | null
          expert_payout_batch_id?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          last_rebroadcast_at?: string | null
          partner_payout_batch_id?: string | null
          price: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number | null
          refund_attempts?: number
          refund_error?: string | null
          refund_id?: string | null
          refund_next_attempt_at?: string | null
          refund_status?: string | null
          reminder_sent?: boolean
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_reminder_sent?: boolean
          scheduled_time_slot?: string | null
          service_category_id?: string | null
          service_duration_minutes: number
          service_end_at?: string | null
          service_label: string
          slot_type: string
          snapshot_expert_payout?: number | null
          snapshot_hourly_rate?: number | null
          snapshot_hq_share?: number | null
          snapshot_partner_payout?: number | null
          start_otp?: string | null
          started_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Update: {
          address_id?: string | null
          assigned_area_partner_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          broadcast_started_at?: string | null
          cancellation_fee?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commission_rule_id?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          created_at?: string | null
          current_search_radius_km?: number | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          dispatch_alert_sent?: boolean
          dispatch_exhausted_at?: string | null
          end_otp?: string | null
          expert_payout_batch_id?: string | null
          gst_amount?: number
          gst_percent?: number
          id?: string
          last_rebroadcast_at?: string | null
          partner_payout_batch_id?: string | null
          price?: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number | null
          refund_attempts?: number
          refund_error?: string | null
          refund_id?: string | null
          refund_next_attempt_at?: string | null
          refund_status?: string | null
          reminder_sent?: boolean
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_reminder_sent?: boolean
          scheduled_time_slot?: string | null
          service_category_id?: string | null
          service_duration_minutes?: number
          service_end_at?: string | null
          service_label?: string
          slot_type?: string
          snapshot_expert_payout?: number | null
          snapshot_hourly_rate?: number | null
          snapshot_hq_share?: number | null
          snapshot_partner_payout?: number | null
          start_otp?: string | null
          started_at?: string | null
          status?: string
          total_amount?: number
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
            foreignKeyName: "bookings_assigned_area_partner_id_fkey"
            columns: ["assigned_area_partner_id"]
            isOneToOne: false
            referencedRelation: "area_partners"
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
            foreignKeyName: "bookings_commission_rule_id_fkey"
            columns: ["commission_rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_expert_payout_batch_id_fkey"
            columns: ["expert_payout_batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_partner_payout_batch_id_fkey"
            columns: ["partner_payout_batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
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
      campaign_deliveries: {
        Row: {
          campaign_id: string
          error: string | null
          id: string
          sent_at: string
          status: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          error?: string | null
          id?: string
          sent_at?: string
          status?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          error?: string | null
          id?: string
          sent_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_deliveries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_messages: {
        Row: {
          city: string
          created_at: string
          id: string
          is_active: boolean
          message_key: string
          message_text: string
          updated_at: string
        }
        Insert: {
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          message_key: string
          message_text: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          is_active?: boolean
          message_key?: string
          message_text?: string
          updated_at?: string
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
      commission_rules: {
        Row: {
          created_at: string
          expert_type: string
          expert_value: number
          id: string
          is_active: boolean
          min_hq_share: number
          notes: string | null
          partner_type: string
          partner_value: number
          price_option_id: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expert_type?: string
          expert_value?: number
          id?: string
          is_active?: boolean
          min_hq_share?: number
          notes?: string | null
          partner_type?: string
          partner_value?: number
          price_option_id?: string | null
          scope?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expert_type?: string
          expert_value?: number
          id?: string
          is_active?: boolean
          min_hq_share?: number
          notes?: string | null
          partner_type?: string
          partner_value?: number
          price_option_id?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_price_option_id_fkey"
            columns: ["price_option_id"]
            isOneToOne: false
            referencedRelation: "service_price_options"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          base_amount: number
          booking_id: string | null
          coupon_id: string
          created_at: string
          discount_amount: number
          id: string
          razorpay_order_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_amount?: number
          booking_id?: string | null
          coupon_id: string
          created_at?: string
          discount_amount?: number
          id?: string
          razorpay_order_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_amount?: number
          booking_id?: string | null
          coupon_id?: string
          created_at?: string
          discount_amount?: number
          id?: string
          razorpay_order_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          audience: string
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          max_discount: number | null
          min_order_amount: number
          per_user_limit: number
          title: string
          total_usage_limit: number | null
          updated_at: string
          used_count: number
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          audience?: string
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_order_amount?: number
          per_user_limit?: number
          title?: string
          total_usage_limit?: number | null
          updated_at?: string
          used_count?: number
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          audience?: string
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_order_amount?: number
          per_user_limit?: number
          title?: string
          total_usage_limit?: number | null
          updated_at?: string
          used_count?: number
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      courier_location_read_log: {
        Row: {
          created_at: string
          customer_id: string
          id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
        }
        Relationships: []
      }
      courier_offers: {
        Row: {
          created_at: string
          distance_km: number | null
          expert_id: string
          expires_at: string
          id: string
          order_id: string
          responded_at: string | null
          sent_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          expert_id: string
          expires_at: string
          id?: string
          order_id: string
          responded_at?: string | null
          sent_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          expert_id?: string
          expires_at?: string
          id?: string
          order_id?: string
          responded_at?: string | null
          sent_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_offers_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_offers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "courier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_order_events: {
        Row: {
          actor_id: string | null
          actor_type: string | null
          created_at: string
          from_status: string | null
          id: string
          meta: Json
          order_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          meta?: Json
          order_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          meta?: Json
          order_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "courier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_order_secrets: {
        Row: {
          created_at: string
          delivery_attempts: number
          delivery_last_sent_at: string | null
          delivery_otp_expires_at: string | null
          delivery_otp_hash: string | null
          delivery_otp_issued_at: string | null
          delivery_send_count: number
          delivery_verified_at: string | null
          locked_until: string | null
          order_id: string
          pickup_attempts: number
          pickup_last_sent_at: string | null
          pickup_otp_expires_at: string | null
          pickup_otp_hash: string | null
          pickup_otp_issued_at: string | null
          pickup_send_count: number
          pickup_verified_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivery_attempts?: number
          delivery_last_sent_at?: string | null
          delivery_otp_expires_at?: string | null
          delivery_otp_hash?: string | null
          delivery_otp_issued_at?: string | null
          delivery_send_count?: number
          delivery_verified_at?: string | null
          locked_until?: string | null
          order_id: string
          pickup_attempts?: number
          pickup_last_sent_at?: string | null
          pickup_otp_expires_at?: string | null
          pickup_otp_hash?: string | null
          pickup_otp_issued_at?: string | null
          pickup_send_count?: number
          pickup_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivery_attempts?: number
          delivery_last_sent_at?: string | null
          delivery_otp_expires_at?: string | null
          delivery_otp_hash?: string | null
          delivery_otp_issued_at?: string | null
          delivery_send_count?: number
          delivery_verified_at?: string | null
          locked_until?: string | null
          order_id?: string
          pickup_attempts?: number
          pickup_last_sent_at?: string | null
          pickup_otp_expires_at?: string | null
          pickup_otp_hash?: string | null
          pickup_otp_issued_at?: string | null
          pickup_send_count?: number
          pickup_verified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_order_secrets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "courier_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_orders: {
        Row: {
          arrived_pickup_at: string | null
          assigned_at: string | null
          assigned_expert_id: string | null
          base_amount: number
          cancel_reason_code: string | null
          cancellation_fee: number
          cancelled_at: string | null
          cancelled_by: string | null
          city: string
          commission_pct: number
          completed_at: string | null
          coupon_code: string | null
          coupon_id: string | null
          courier_type_id: string
          created_at: string
          current_search_radius_km: number | null
          customer_id: string
          delivered_at: string | null
          discount_amount: number
          distance_km: number
          distance_source: string
          drop_address: string
          drop_contact_edit_count: number
          drop_contact_name: string
          drop_contact_phone: string
          drop_lat: number
          drop_lng: number
          earnings_credited_at: string | null
          extra_fee: number
          fare_breakdown: Json
          gst_amount: number
          gst_percent: number
          id: string
          in_transit_at: string | null
          incident_code: string | null
          incident_notes: string | null
          incident_resolution: string | null
          needs_ops_attention: boolean
          order_code: string
          otp_attempts: number
          package_description: string | null
          payment_status: string
          picked_up_at: string | null
          pickup_address: string
          pickup_contact_edit_count: number
          pickup_contact_name: string
          pickup_contact_phone: string
          pickup_lat: number
          pickup_lng: number
          platform_fee: number
          prohibited_items_confirmed: boolean
          proof_photo_url: string | null
          quote_expires_at: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number
          refund_attempts: number
          refund_id: string | null
          refund_next_attempt_at: string | null
          refund_reason: string | null
          refund_status: string
          rider_cancel_count: number
          search_started_at: string | null
          status: string
          total_amount: number
          updated_at: string
          vehicle_type_id: string
          wallet_amount: number
          weight_kg: number
        }
        Insert: {
          arrived_pickup_at?: string | null
          assigned_at?: string | null
          assigned_expert_id?: string | null
          base_amount?: number
          cancel_reason_code?: string | null
          cancellation_fee?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          city: string
          commission_pct?: number
          completed_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          courier_type_id: string
          created_at?: string
          current_search_radius_km?: number | null
          customer_id: string
          delivered_at?: string | null
          discount_amount?: number
          distance_km?: number
          distance_source?: string
          drop_address: string
          drop_contact_edit_count?: number
          drop_contact_name: string
          drop_contact_phone: string
          drop_lat: number
          drop_lng: number
          earnings_credited_at?: string | null
          extra_fee?: number
          fare_breakdown?: Json
          gst_amount?: number
          gst_percent?: number
          id?: string
          in_transit_at?: string | null
          incident_code?: string | null
          incident_notes?: string | null
          incident_resolution?: string | null
          needs_ops_attention?: boolean
          order_code?: string
          otp_attempts?: number
          package_description?: string | null
          payment_status?: string
          picked_up_at?: string | null
          pickup_address: string
          pickup_contact_edit_count?: number
          pickup_contact_name: string
          pickup_contact_phone: string
          pickup_lat: number
          pickup_lng: number
          platform_fee?: number
          prohibited_items_confirmed?: boolean
          proof_photo_url?: string | null
          quote_expires_at?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number
          refund_attempts?: number
          refund_id?: string | null
          refund_next_attempt_at?: string | null
          refund_reason?: string | null
          refund_status?: string
          rider_cancel_count?: number
          search_started_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          vehicle_type_id: string
          wallet_amount?: number
          weight_kg?: number
        }
        Update: {
          arrived_pickup_at?: string | null
          assigned_at?: string | null
          assigned_expert_id?: string | null
          base_amount?: number
          cancel_reason_code?: string | null
          cancellation_fee?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          city?: string
          commission_pct?: number
          completed_at?: string | null
          coupon_code?: string | null
          coupon_id?: string | null
          courier_type_id?: string
          created_at?: string
          current_search_radius_km?: number | null
          customer_id?: string
          delivered_at?: string | null
          discount_amount?: number
          distance_km?: number
          distance_source?: string
          drop_address?: string
          drop_contact_edit_count?: number
          drop_contact_name?: string
          drop_contact_phone?: string
          drop_lat?: number
          drop_lng?: number
          earnings_credited_at?: string | null
          extra_fee?: number
          fare_breakdown?: Json
          gst_amount?: number
          gst_percent?: number
          id?: string
          in_transit_at?: string | null
          incident_code?: string | null
          incident_notes?: string | null
          incident_resolution?: string | null
          needs_ops_attention?: boolean
          order_code?: string
          otp_attempts?: number
          package_description?: string | null
          payment_status?: string
          picked_up_at?: string | null
          pickup_address?: string
          pickup_contact_edit_count?: number
          pickup_contact_name?: string
          pickup_contact_phone?: string
          pickup_lat?: number
          pickup_lng?: number
          platform_fee?: number
          prohibited_items_confirmed?: boolean
          proof_photo_url?: string | null
          quote_expires_at?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          refund_amount?: number
          refund_attempts?: number
          refund_id?: string | null
          refund_next_attempt_at?: string | null
          refund_reason?: string | null
          refund_status?: string
          rider_cancel_count?: number
          search_started_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          vehicle_type_id?: string
          wallet_amount?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "courier_orders_assigned_expert_id_fkey"
            columns: ["assigned_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_orders_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_orders_courier_type_id_fkey"
            columns: ["courier_type_id"]
            isOneToOne: false
            referencedRelation: "courier_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_orders_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "courier_vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_quote_log: {
        Row: {
          created_at: string
          customer_id: string
          id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
        }
        Relationships: []
      }
      courier_types: {
        Row: {
          created_at: string
          extra_fee: number
          icon: string | null
          id: string
          instructions: string | null
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          extra_fee?: number
          icon?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          extra_fee?: number
          icon?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      courier_vehicle_courier_types: {
        Row: {
          courier_type_id: string
          created_at: string
          id: string
          is_active: boolean
          vehicle_type_id: string
        }
        Insert: {
          courier_type_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          vehicle_type_id: string
        }
        Update: {
          courier_type_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_vehicle_courier_types_courier_type_id_fkey"
            columns: ["courier_type_id"]
            isOneToOne: false
            referencedRelation: "courier_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courier_vehicle_courier_types_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "courier_vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_vehicle_rates: {
        Row: {
          base_fare: number
          city: string
          commission_pct: number
          created_at: string
          id: string
          included_km: number
          is_placeholder: boolean
          min_fare: number
          per_km: number
          platform_fee: number
          updated_at: string
          vehicle_type_id: string
        }
        Insert: {
          base_fare?: number
          city: string
          commission_pct?: number
          created_at?: string
          id?: string
          included_km?: number
          is_placeholder?: boolean
          min_fare?: number
          per_km?: number
          platform_fee?: number
          updated_at?: string
          vehicle_type_id: string
        }
        Update: {
          base_fare?: number
          city?: string
          commission_pct?: number
          created_at?: string
          id?: string
          included_km?: number
          is_placeholder?: boolean
          min_fare?: number
          per_km?: number
          platform_fee?: number
          updated_at?: string
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_vehicle_rates_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "courier_vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_vehicle_types: {
        Row: {
          created_at: string
          exclusions: string[]
          icon: string | null
          id: string
          inclusions: string[]
          is_active: boolean
          max_weight_kg: number
          name: string
          required_documents: string[]
          required_skill: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          exclusions?: string[]
          icon?: string | null
          id?: string
          inclusions?: string[]
          is_active?: boolean
          max_weight_kg?: number
          name: string
          required_documents?: string[]
          required_skill?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          exclusions?: string[]
          icon?: string | null
          id?: string
          inclusions?: string[]
          is_active?: boolean
          max_weight_kg?: number
          name?: string
          required_documents?: string[]
          required_skill?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_vehicle_types_required_skill_fkey"
            columns: ["required_skill"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      courier_zones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courier_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: true
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_coupons: {
        Row: {
          coupon_id: string
          created_at: string
          expires_at: string | null
          id: string
          source: string
          source_ref: string | null
          status: string
          updated_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          source?: string
          source_ref?: string | null
          status?: string
          updated_at?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          source?: string
          source_ref?: string | null
          status?: string
          updated_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_coupons_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
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
      dispatch_alert_events: {
        Row: {
          alert_type: string
          booking_id: string
          city: string | null
          id: string
          payload: Json
          triggered_at: string
          whatsapp_sent: boolean
          zone_id: string | null
        }
        Insert: {
          alert_type: string
          booking_id: string
          city?: string | null
          id?: string
          payload?: Json
          triggered_at?: string
          whatsapp_sent?: boolean
          zone_id?: string | null
        }
        Update: {
          alert_type?: string
          booking_id?: string
          city?: string | null
          id?: string
          payload?: Json
          triggered_at?: string
          whatsapp_sent?: boolean
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_alert_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_config: {
        Row: {
          aisensy_template_name: string | null
          almost_available_window_minutes: number
          broadcast_radius_km: number
          broadcast_timeout_seconds: number
          city: string
          created_at: string
          id: string
          no_accept_alert_threshold_seconds: number
          no_expert_timeout_minutes: number
          ops_alert_whatsapp_numbers: string[]
          radius_expand_after_seconds: number
          radius_expand_max_km: number
          radius_expand_step_km: number
          updated_at: string
        }
        Insert: {
          aisensy_template_name?: string | null
          almost_available_window_minutes?: number
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          no_accept_alert_threshold_seconds?: number
          no_expert_timeout_minutes?: number
          ops_alert_whatsapp_numbers?: string[]
          radius_expand_after_seconds?: number
          radius_expand_max_km?: number
          radius_expand_step_km?: number
          updated_at?: string
        }
        Update: {
          aisensy_template_name?: string | null
          almost_available_window_minutes?: number
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          no_accept_alert_threshold_seconds?: number
          no_expert_timeout_minutes?: number
          ops_alert_whatsapp_numbers?: string[]
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
      expert_holiday_notices: {
        Row: {
          created_at: string
          holiday_id: string
          id: string
          phase: string
        }
        Insert: {
          created_at?: string
          holiday_id: string
          id?: string
          phase: string
        }
        Update: {
          created_at?: string
          holiday_id?: string
          id?: string
          phase?: string
        }
        Relationships: []
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
      expert_zones: {
        Row: {
          created_at: string
          expert_id: string
          id: string
          is_primary: boolean
          zone_id: string
        }
        Insert: {
          created_at?: string
          expert_id: string
          id?: string
          is_primary?: boolean
          zone_id: string
        }
        Update: {
          created_at?: string
          expert_id?: string
          id?: string
          is_primary?: boolean
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_zones_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
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
          offline_after_job: boolean
          onboarded_by: string | null
          pan_encrypted: string | null
          pan_last4: string | null
          pan_updated_at: string | null
          phone: string
          photo_url: string | null
          pin_hash: string | null
          preferred_language: string
          referred_by_expert_id: string | null
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
          offline_after_job?: boolean
          onboarded_by?: string | null
          pan_encrypted?: string | null
          pan_last4?: string | null
          pan_updated_at?: string | null
          phone: string
          photo_url?: string | null
          pin_hash?: string | null
          preferred_language?: string
          referred_by_expert_id?: string | null
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
          offline_after_job?: boolean
          onboarded_by?: string | null
          pan_encrypted?: string | null
          pan_last4?: string | null
          pan_updated_at?: string | null
          phone?: string
          photo_url?: string | null
          pin_hash?: string | null
          preferred_language?: string
          referred_by_expert_id?: string | null
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
            foreignKeyName: "experts_referred_by_expert_id_fkey"
            columns: ["referred_by_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
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
      internal_testers: {
        Row: {
          created_at: string
          note: string | null
          phone: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          phone: string
        }
        Update: {
          created_at?: string
          note?: string | null
          phone?: string
        }
        Relationships: []
      }
      item_task_types: {
        Row: {
          created_at: string
          display_order: number
          id: string
          price_option_id: string
          task_type_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          price_option_id: string
          task_type_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          price_option_id?: string
          task_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_task_types_price_option_id_fkey"
            columns: ["price_option_id"]
            isOneToOne: false
            referencedRelation: "service_price_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_task_types_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
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
      marketing_campaigns: {
        Row: {
          audience: string
          body: string
          coupon_id: string | null
          created_at: string
          created_by: string | null
          deep_link: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          recipients_count: number
          scheduled_at: string | null
          sent_at: string | null
          show_in_offers: boolean
          starts_at: string
          status: string
          target_user_ids: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          body?: string
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          show_in_offers?: boolean
          starts_at?: string
          status?: string
          target_user_ids?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          body?: string
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          recipients_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          show_in_offers?: boolean
          starts_at?: string
          status?: string
          target_user_ids?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
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
          {
            foreignKeyName: "merchant_documents_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
          {
            foreignKeyName: "merchant_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            foreignKeyName: "merchant_orders_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
          {
            foreignKeyName: "merchant_roles_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
          {
            foreignKeyName: "merchant_schedule_overrides_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
            foreignKeyName: "merchant_staff_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
          {
            foreignKeyName: "merchant_store_hours_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
          {
            foreignKeyName: "merchant_subscription_invoices_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
            foreignKeyName: "offline_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            foreignKeyName: "offline_sales_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
      ops_settings: {
        Row: {
          key: string
          label: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          label: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          label?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
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
      payment_intents: {
        Row: {
          alerted_at: string | null
          amount: number
          attempts: number
          booking_id: string | null
          created_at: string
          currency: string
          id: string
          last_error: string | null
          payload: Json
          razorpay_order_id: string
          razorpay_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alerted_at?: string | null
          amount: number
          attempts?: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          last_error?: string | null
          payload: Json
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alerted_at?: string | null
          amount?: number
          attempts?: number
          booking_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          last_error?: string | null
          payload?: Json
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
          gross_amount: number | null
          id: string
          ledger_ids: string[]
          net_amount: number | null
          owner_id: string
          owner_type: string
          paid: boolean
          paid_at: string | null
          pan_last4: string | null
          tds_amount: number
          tds_deposited_at: string | null
          tds_rate: number
          tds_status: string
        }
        Insert: {
          amount?: number
          batch_id: string
          booking_ids?: string[]
          created_at?: string
          gross_amount?: number | null
          id?: string
          ledger_ids?: string[]
          net_amount?: number | null
          owner_id: string
          owner_type: string
          paid?: boolean
          paid_at?: string | null
          pan_last4?: string | null
          tds_amount?: number
          tds_deposited_at?: string | null
          tds_rate?: number
          tds_status?: string
        }
        Update: {
          amount?: number
          batch_id?: string
          booking_ids?: string[]
          created_at?: string
          gross_amount?: number | null
          id?: string
          ledger_ids?: string[]
          net_amount?: number | null
          owner_id?: string
          owner_type?: string
          paid?: boolean
          paid_at?: string | null
          pan_last4?: string | null
          tds_amount?: number
          tds_deposited_at?: string | null
          tds_rate?: number
          tds_status?: string
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
          admin_hidden: boolean
          admin_hidden_reason: string | null
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
          admin_hidden?: boolean
          admin_hidden_reason?: string | null
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
          admin_hidden?: boolean
          admin_hidden_reason?: string | null
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
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
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
      referral_milestone_awards: {
        Row: {
          coupon_id: string | null
          created_at: string
          id: string
          program_id: string
          referrals_at_award: number
          user_id: string
        }
        Insert: {
          coupon_id?: string | null
          created_at?: string
          id?: string
          program_id: string
          referrals_at_award?: number
          user_id: string
        }
        Update: {
          coupon_id?: string | null
          created_at?: string
          id?: string
          program_id?: string
          referrals_at_award?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_milestone_awards_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_milestone_awards_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "referral_milestone_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_milestone_programs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          required_referrals: number
          reward_discount_type: string
          reward_discount_value: number
          reward_max_discount: number | null
          reward_min_order_amount: number
          reward_validity_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          required_referrals?: number
          reward_discount_type?: string
          reward_discount_value?: number
          reward_max_discount?: number | null
          reward_min_order_amount?: number
          reward_validity_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          required_referrals?: number
          reward_discount_type?: string
          reward_discount_value?: number
          reward_max_discount?: number | null
          reward_min_order_amount?: number
          reward_validity_days?: number
          updated_at?: string
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
      reward_ledger: {
        Row: {
          actor_id: string
          actor_type: string
          credited_at: string
          id: string
          notes: string | null
          program_id: string | null
          program_name: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reward_type: string
          reward_value: number
          status: string
          trigger_event_ref: string
        }
        Insert: {
          actor_id: string
          actor_type: string
          credited_at?: string
          id?: string
          notes?: string | null
          program_id?: string | null
          program_name?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reward_type: string
          reward_value?: number
          status?: string
          trigger_event_ref: string
        }
        Update: {
          actor_id?: string
          actor_type?: string
          credited_at?: string
          id?: string
          notes?: string | null
          program_id?: string | null
          program_name?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reward_type?: string
          reward_value?: number
          status?: string
          trigger_event_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_ledger_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "reward_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_ledger_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_programs: {
        Row: {
          actor_type: string
          archived_at: string | null
          condition: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          recurrence: string
          reward_type: string
          reward_value: number
          trigger_type: string
          updated_at: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          actor_type: string
          archived_at?: string | null
          condition?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          recurrence?: string
          reward_type: string
          reward_value?: number
          trigger_type: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          actor_type?: string
          archived_at?: string | null
          condition?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          recurrence?: string
          reward_type?: string
          reward_value?: number
          trigger_type?: string
          updated_at?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_programs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_programs_trigger_type_fkey"
            columns: ["trigger_type"]
            isOneToOne: false
            referencedRelation: "reward_trigger_types"
            referencedColumns: ["key"]
          },
        ]
      }
      reward_trigger_types: {
        Row: {
          actor_types: string[]
          condition_schema: Json
          description: string | null
          display_order: number
          is_active: boolean
          is_time_based: boolean
          key: string
          label: string
        }
        Insert: {
          actor_types?: string[]
          condition_schema?: Json
          description?: string | null
          display_order?: number
          is_active?: boolean
          is_time_based?: boolean
          key: string
          label: string
        }
        Update: {
          actor_types?: string[]
          condition_schema?: Json
          description?: string | null
          display_order?: number
          is_active?: boolean
          is_time_based?: boolean
          key?: string
          label?: string
        }
        Relationships: []
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
      service_flags: {
        Row: {
          city: string
          closed_today_date: string | null
          closed_today_reason: string | null
          closed_until: string | null
          created_at: string
          hours_enabled: boolean
          id: string
          is_active: boolean
          label: string
          last_order_buffer_minutes: number
          resume_at: string | null
          service_key: string
          sort_order: number
          status: string
          status_message_en: string | null
          status_message_mr: string | null
          status_updated_at: string | null
          status_updated_by: string | null
          updated_at: string
        }
        Insert: {
          city: string
          closed_today_date?: string | null
          closed_today_reason?: string | null
          closed_until?: string | null
          created_at?: string
          hours_enabled?: boolean
          id?: string
          is_active?: boolean
          label: string
          last_order_buffer_minutes?: number
          resume_at?: string | null
          service_key: string
          sort_order?: number
          status?: string
          status_message_en?: string | null
          status_message_mr?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          updated_at?: string
        }
        Update: {
          city?: string
          closed_today_date?: string | null
          closed_today_reason?: string | null
          closed_until?: string | null
          created_at?: string
          hours_enabled?: boolean
          id?: string
          is_active?: boolean
          label?: string
          last_order_buffer_minutes?: number
          resume_at?: string | null
          service_key?: string
          sort_order?: number
          status?: string
          status_message_en?: string | null
          status_message_mr?: string | null
          status_updated_at?: string | null
          status_updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_focus_snapshots: {
        Row: {
          active_orders: Json
          after: Json
          before: Json
          created_at: string
          created_by: string
          expires_at: string
          undo_token: string
          used_at: string | null
        }
        Insert: {
          active_orders?: Json
          after: Json
          before: Json
          created_at?: string
          created_by: string
          expires_at: string
          undo_token?: string
          used_at?: string | null
        }
        Update: {
          active_orders?: Json
          after?: Json
          before?: Json
          created_at?: string
          created_by?: string
          expires_at?: string
          undo_token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      service_holidays: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          reason: string | null
          reason_mr: string | null
          service_flag_id: string | null
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          reason?: string | null
          reason_mr?: string | null
          service_flag_id?: string | null
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          reason?: string | null
          reason_mr?: string | null
          service_flag_id?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_holidays_service_flag_id_fkey"
            columns: ["service_flag_id"]
            isOneToOne: false
            referencedRelation: "service_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      service_hours: {
        Row: {
          close_time: string
          created_at: string
          id: string
          is_closed: boolean
          open_time: string
          service_flag_id: string
          updated_at: string
          weekday: number
        }
        Insert: {
          close_time?: string
          created_at?: string
          id?: string
          is_closed?: boolean
          open_time?: string
          service_flag_id: string
          updated_at?: string
          weekday: number
        }
        Update: {
          close_time?: string
          created_at?: string
          id?: string
          is_closed?: boolean
          open_time?: string
          service_flag_id?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_hours_service_flag_id_fkey"
            columns: ["service_flag_id"]
            isOneToOne: false
            referencedRelation: "service_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      service_hours_bypass_users: {
        Row: {
          created_at: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_notify_requests: {
        Row: {
          created_at: string
          id: string
          notified_at: string | null
          service_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notified_at?: string | null
          service_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notified_at?: string | null
          service_key?: string
          user_id?: string
        }
        Relationships: []
      }
      service_price_options: {
        Row: {
          created_at: string
          customer_price: number
          description: string | null
          display_order: number
          duration_minutes: number | null
          exclusions: string[]
          expert_payout: number | null
          gallery_urls: string[]
          hq_share: number | null
          id: string
          image_url: string | null
          inclusions: string[]
          is_active: boolean
          label: string
          partner_commission: number | null
          service_id: string
          strikethrough_price: number | null
          unit_label: string | null
          video_url: string | null
        }
        Insert: {
          created_at?: string
          customer_price?: number
          description?: string | null
          display_order?: number
          duration_minutes?: number | null
          exclusions?: string[]
          expert_payout?: number | null
          gallery_urls?: string[]
          hq_share?: number | null
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          label: string
          partner_commission?: number | null
          service_id: string
          strikethrough_price?: number | null
          unit_label?: string | null
          video_url?: string | null
        }
        Update: {
          created_at?: string
          customer_price?: number
          description?: string | null
          display_order?: number
          duration_minutes?: number | null
          exclusions?: string[]
          expert_payout?: number | null
          gallery_urls?: string[]
          hq_share?: number | null
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          label?: string
          partner_commission?: number | null
          service_id?: string
          strikethrough_price?: number | null
          unit_label?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_price_options_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          category_id: string
          created_at: string
          description: string | null
          display_order: number
          exclusions: string[]
          gallery_urls: string[]
          id: string
          image_url: string | null
          inclusions: string[]
          is_active: boolean
          name: string
          pricing_type: string
          video_url: string | null
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string | null
          display_order?: number
          exclusions?: string[]
          gallery_urls?: string[]
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          name: string
          pricing_type?: string
          video_url?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string | null
          display_order?: number
          exclusions?: string[]
          gallery_urls?: string[]
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          name?: string
          pricing_type?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notification_state: {
        Row: {
          auth_user_id: string
          created_at: string
          dismissed_at: string | null
          notification_id: string
          read_at: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          dismissed_at?: string | null
          notification_id: string
          read_at?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          dismissed_at?: string | null
          notification_id?: string
          read_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notification_state_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "staff_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notifications: {
        Row: {
          created_at: string
          detail: string | null
          event_at: string
          id: string
          kind: string
          notif_key: string
          target: string
          target_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          event_at?: string
          id?: string
          kind: string
          notif_key: string
          target?: string
          target_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          event_at?: string
          id?: string
          kind?: string
          notif_key?: string
          target?: string
          target_id?: string | null
          title?: string
        }
        Relationships: []
      }
      staff_user_zones: {
        Row: {
          created_at: string
          id: string
          staff_user_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          staff_user_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          staff_user_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_user_zones_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_user_zones_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
          icon: string | null
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          rank: number
          segment_id: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          icon?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          rank?: number
          segment_id: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          icon?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          rank?: number
          segment_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
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
      support_ticket_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          sender_id: string | null
          sender_type: string
          ticket_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_type: string
          ticket_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          booking_id: string | null
          category: string
          created_at: string
          id: string
          internal_note: string | null
          last_message_at: string
          message: string
          resolution_outcome: string | null
          resolution_summary: string | null
          resolved_at: string | null
          resolved_by: string | null
          source: string
          status: string
          subject: string | null
          unread_for_customer: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          category?: string
          created_at?: string
          id?: string
          internal_note?: string | null
          last_message_at?: string
          message: string
          resolution_outcome?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
          subject?: string | null
          unread_for_customer?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          category?: string
          created_at?: string
          id?: string
          internal_note?: string | null
          last_message_at?: string
          message?: string
          resolution_outcome?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source?: string
          status?: string
          subject?: string | null
          unread_for_customer?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_types: {
        Row: {
          created_at: string
          description: string | null
          exclusions: string[]
          id: string
          image_url: string | null
          inclusions: string[]
          is_active: boolean
          name: string
          rank: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          exclusions?: string[]
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          name: string
          rank?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          exclusions?: string[]
          id?: string
          image_url?: string | null
          inclusions?: string[]
          is_active?: boolean
          name?: string
          rank?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
      waitlist_notify_events: {
        Row: {
          channel: string
          city: string | null
          created_at: string
          expert_id: string | null
          id: string
          payload: Json
          segment_id: string | null
          waitlist_id: string
          whatsapp_status: string
        }
        Insert: {
          channel?: string
          city?: string | null
          created_at?: string
          expert_id?: string | null
          id?: string
          payload?: Json
          segment_id?: string | null
          waitlist_id: string
          whatsapp_status?: string
        }
        Update: {
          channel?: string
          city?: string | null
          created_at?: string
          expert_id?: string | null
          id?: string
          payload?: Json
          segment_id?: string | null
          waitlist_id?: string
          whatsapp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_notify_events_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_notify_events_waitlist_id_fkey"
            columns: ["waitlist_id"]
            isOneToOne: false
            referencedRelation: "waitlist_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_requests: {
        Row: {
          address_text: string | null
          city: string | null
          created_at: string
          id: string
          latitude: number
          longitude: number
          notified_at: string | null
          notify_count: number
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
          notified_at?: string | null
          notify_count?: number
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
          notified_at?: string | null
          notify_count?: number
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
      public_products: {
        Row: {
          description: string | null
          id: string | null
          in_stock: boolean | null
          merchant_id: string | null
          mrp: number | null
          name: string | null
          photo_url: string | null
          price: number | null
          product_category: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "public_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      public_stores: {
        Row: {
          category_name: string | null
          category_slug: string | null
          id: string | null
          is_accepting_orders: boolean | null
          is_open_now: boolean | null
          lat: number | null
          lng: number | null
          photo_url: string | null
          rating: number | null
          short_address: string | null
          store_category_id: string | null
          store_name: string | null
          zone_id: string | null
        }
        Relationships: [
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
    }
    Functions: {
      admin_alert_claim_batch: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          id: string
          order_id: string
          order_type: string
          v_amount: string
          v_customer: string
          v_order: string
          v_time: string
        }[]
      }
      admin_alert_clean: { Args: { _v: string }; Returns: string }
      admin_alert_dispatch: { Args: never; Returns: undefined }
      admin_alert_enabled: { Args: { _key: string }; Returns: boolean }
      admin_alert_enqueue: {
        Args: {
          _amount: number
          _customer: string
          _order: string
          _order_id: string
          _order_type: string
          _time: string
        }
        Returns: undefined
      }
      admin_alert_mark: {
        Args: { _error?: string; _id: string; _ok: boolean }
        Returns: undefined
      }
      admin_alert_verify_job_secret: {
        Args: { _secret: string }
        Returns: boolean
      }
      advance_booking_status: {
        Args: { _booking_id: string; _new_status: string }
        Returns: undefined
      }
      apply_referral_code: { Args: { _code: string }; Returns: string }
      award_referral_milestones: { Args: { _user_id: string }; Returns: number }
      booking_dispatch_refund_job: { Args: never; Returns: undefined }
      booking_verify_job_secret: { Args: { _secret: string }; Returns: boolean }
      broadcast_booking_to_experts: {
        Args: { _booking_id: string; _radius?: number }
        Returns: number
      }
      check_booking_capacity: { Args: { _booking_id: string }; Returns: Json }
      check_serviceability: {
        Args: { _lat: number; _lng: number; _segment_id?: string }
        Returns: Json
      }
      claim_booking_as_expert: {
        Args: { p_booking_id: string }
        Returns: {
          address_id: string | null
          assigned_area_partner_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          broadcast_started_at: string | null
          cancellation_fee: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commission_rule_id: string | null
          coupon_code: string | null
          coupon_id: string | null
          created_at: string | null
          current_search_radius_km: number | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number
          dispatch_alert_sent: boolean
          dispatch_exhausted_at: string | null
          end_otp: string | null
          expert_payout_batch_id: string | null
          gst_amount: number
          gst_percent: number
          id: string
          last_rebroadcast_at: string | null
          partner_payout_batch_id: string | null
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number | null
          refund_attempts: number
          refund_error: string | null
          refund_id: string | null
          refund_next_attempt_at: string | null
          refund_status: string | null
          reminder_sent: boolean
          review_text: string | null
          scheduled_date: string | null
          scheduled_reminder_sent: boolean
          scheduled_time_slot: string | null
          service_category_id: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          snapshot_expert_payout: number | null
          snapshot_hourly_rate: number | null
          snapshot_hq_share: number | null
          snapshot_partner_payout: number | null
          start_otp: string | null
          started_at: string | null
          status: string
          total_amount: number
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
      compute_tds: {
        Args: { _gross: number; _owner_id: string; _owner_type: string }
        Returns: {
          amount: number
          applicable: boolean
          pan_last4: string
          rate: number
        }[]
      }
      coupon_preview: {
        Args: {
          _base_amount: number
          _code: string
          _duration_minutes?: number
        }
        Returns: Json
      }
      coupon_quote: {
        Args: {
          _base_amount: number
          _code: string
          _duration_minutes?: number
          _user_id: string
        }
        Returns: Json
      }
      courier_booking_start_at: {
        Args: { _d: string; _slot: string }
        Returns: string
      }
      courier_cancel_order: {
        Args: { _order_id: string; _reason?: string }
        Returns: Json
      }
      courier_check_serviceability: {
        Args: { _lat: number; _lng: number }
        Returns: Json
      }
      courier_create_order: {
        Args: { _customer_id: string; _payload: Json }
        Returns: Json
      }
      courier_derive_otp: {
        Args: { _issued_at: string; _order_id: string; _purpose: string }
        Returns: string
      }
      courier_dispatch_next: { Args: { _order_id: string }; Returns: boolean }
      courier_dispatch_refund_job: { Args: never; Returns: undefined }
      courier_eligible_riders: {
        Args: { _order_id: string; _radius: number }
        Returns: {
          distance_km: number
          expert_id: string
        }[]
      }
      courier_get_otp: {
        Args: { _order_id: string; _purpose: string }
        Returns: Json
      }
      courier_get_rider_info: { Args: { _order_id: string }; Returns: Json }
      courier_get_rider_location: { Args: { _order_id: string }; Returns: Json }
      courier_hash_otp: { Args: { _otp: string }; Returns: string }
      courier_is_ops_staff: { Args: never; Returns: boolean }
      courier_is_super_admin: { Args: never; Returns: boolean }
      courier_issue_otp: {
        Args: { _order_id: string; _purpose: string }
        Returns: string
      }
      courier_log_otp_send: {
        Args: {
          _detail: string
          _ok: boolean
          _order_id: string
          _purpose: string
        }
        Returns: undefined
      }
      courier_mark_refund_pending: {
        Args: { _amount: number; _order_id: string; _reason: string }
        Returns: undefined
      }
      courier_offer_respond: {
        Args: { _accept: boolean; _offer_id: string }
        Returns: Json
      }
      courier_otp_key: { Args: never; Returns: string }
      courier_otp_owner_gate: {
        Args: { _order_id: string; _purpose: string }
        Returns: {
          arrived_pickup_at: string | null
          assigned_at: string | null
          assigned_expert_id: string | null
          base_amount: number
          cancel_reason_code: string | null
          cancellation_fee: number
          cancelled_at: string | null
          cancelled_by: string | null
          city: string
          commission_pct: number
          completed_at: string | null
          coupon_code: string | null
          coupon_id: string | null
          courier_type_id: string
          created_at: string
          current_search_radius_km: number | null
          customer_id: string
          delivered_at: string | null
          discount_amount: number
          distance_km: number
          distance_source: string
          drop_address: string
          drop_contact_edit_count: number
          drop_contact_name: string
          drop_contact_phone: string
          drop_lat: number
          drop_lng: number
          earnings_credited_at: string | null
          extra_fee: number
          fare_breakdown: Json
          gst_amount: number
          gst_percent: number
          id: string
          in_transit_at: string | null
          incident_code: string | null
          incident_notes: string | null
          incident_resolution: string | null
          needs_ops_attention: boolean
          order_code: string
          otp_attempts: number
          package_description: string | null
          payment_status: string
          picked_up_at: string | null
          pickup_address: string
          pickup_contact_edit_count: number
          pickup_contact_name: string
          pickup_contact_phone: string
          pickup_lat: number
          pickup_lng: number
          platform_fee: number
          prohibited_items_confirmed: boolean
          proof_photo_url: string | null
          quote_expires_at: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          refund_amount: number
          refund_attempts: number
          refund_id: string | null
          refund_next_attempt_at: string | null
          refund_reason: string | null
          refund_status: string
          rider_cancel_count: number
          search_started_at: string | null
          status: string
          total_amount: number
          updated_at: string
          vehicle_type_id: string
          wallet_amount: number
          weight_kg: number
        }
        SetofOptions: {
          from: "*"
          to: "courier_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      courier_quote_internal: {
        Args: {
          _city: string
          _coupon_code?: string
          _courier_type_id: string
          _customer_id: string
          _distance_km: number
          _vehicle_type_id: string
          _weight_kg: number
        }
        Returns: Json
      }
      courier_refresh_otp: {
        Args: { _order_id: string; _purpose: string }
        Returns: Json
      }
      courier_report_incident: {
        Args: { _code: string; _notes: string; _order_id: string }
        Returns: Json
      }
      courier_resend_otp: {
        Args: { _order_id: string; _purpose: string }
        Returns: Json
      }
      courier_rider_advance: {
        Args: {
          _accuracy_m?: number
          _fix_at?: string
          _lat?: number
          _lng?: number
          _order_id: string
          _to_status: string
        }
        Returns: Json
      }
      courier_rider_cancel: {
        Args: { _order_id: string; _reason: string }
        Returns: Json
      }
      courier_rider_offers: { Args: never; Returns: Json }
      courier_setting: {
        Args: { _default: number; _key: string }
        Returns: number
      }
      courier_settle_order: { Args: { _order_id: string }; Returns: undefined }
      courier_start_dispatch: {
        Args: { _order_id: string }
        Returns: undefined
      }
      courier_sweeper: { Args: never; Returns: undefined }
      courier_sweeper_tick: { Args: never; Returns: undefined }
      courier_update_contact: {
        Args: { _new_phone: string; _order_id: string; _purpose: string }
        Returns: Json
      }
      courier_validate_local_route: {
        Args: {
          _city: string
          _drop_lat: number
          _drop_lng: number
          _pickup_lat: number
          _pickup_lng: number
        }
        Returns: Json
      }
      courier_verify_job_secret: { Args: { _secret: string }; Returns: boolean }
      courier_verify_otp: {
        Args: {
          _order_id: string
          _otp: string
          _proof_url?: string
          _purpose: string
        }
        Returns: Json
      }
      credit_booking_completion: {
        Args: { _booking_id: string }
        Returns: number
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
      customer_delete_account: { Args: never; Returns: undefined }
      customer_delete_address: {
        Args: { p_address_id: string }
        Returns: boolean
      }
      customer_list_devices: { Args: never; Returns: Json }
      customer_notify_me: { Args: { _service_key: string }; Returns: Json }
      customer_register_device: {
        Args: { _device_id: string; _device_label?: string }
        Returns: Json
      }
      customer_revoke_device: {
        Args: { _device_id: string }
        Returns: undefined
      }
      customer_set_language: { Args: { _lang: string }; Returns: undefined }
      customer_update_address: {
        Args: {
          p_address_id: string
          p_area: string
          p_city: string
          p_full_address: string
          p_label: string
          p_landmark_photo_url?: string
          p_latitude: number
          p_longitude: number
        }
        Returns: {
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
          pincode: string | null
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "addresses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_start_otp: { Args: { _booking_id: string }; Returns: string }
      evaluate_reward_triggers: {
        Args: {
          _actor_id: string
          _actor_type: string
          _event_context?: Json
          _event_ref: string
          _trigger_type: string
        }
        Returns: number
      }
      evaluate_zone_capacity: { Args: { _booking_id: string }; Returns: Json }
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
      expert_rewards_overview: { Args: never; Returns: Json }
      expert_service_schedule: { Args: { _service_key: string }; Returns: Json }
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
      expire_stale_online_experts: { Args: never; Returns: number }
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
      get_assigned_expert_location: {
        Args: { _booking_id: string }
        Returns: {
          expert_id: string
          is_online: boolean
          latitude: number
          location_updated_at: string
          longitude: number
          name: string
        }[]
      }
      get_assigned_expert_profile: {
        Args: { _booking_id: string }
        Returns: {
          avg_rating: number
          id: string
          name: string
          phone: string
          photo_url: string
          review_count: number
        }[]
      }
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
      get_customer_auth_id_by_phone: {
        Args: { _phone: string }
        Returns: string
      }
      get_eligible_experts_for_booking: {
        Args: { p_booking_id: string }
        Returns: {
          distance_km: number
          expert_id: string
        }[]
      }
      get_expert_id_for_auth: { Args: { _auth_uid: string }; Returns: string }
      get_gst_percent: { Args: never; Returns: number }
      get_ops_flag: { Args: { _key: string }; Returns: boolean }
      get_ops_num: { Args: { _default: number; _key: string }; Returns: number }
      has_login_pin: { Args: { p_phone: string }; Returns: boolean }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_active_staff: {
        Args: { _roles: string[]; _uid: string }
        Returns: boolean
      }
      is_internal_tester: { Args: never; Returns: boolean }
      is_public_product_image: {
        Args: { _object_name: string }
        Returns: boolean
      }
      is_public_service_image: {
        Args: { object_name: string }
        Returns: boolean
      }
      is_super_admin_user: { Args: never; Returns: boolean }
      is_target_unavailable: {
        Args: { _target_id: string; _target_type: string }
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
      my_coupons: {
        Args: never
        Returns: {
          code: string
          description: string
          discount_type: string
          discount_value: number
          id: string
          is_personal: boolean
          max_discount: number
          min_order_amount: number
          source: string
          title: string
          valid_until: string
        }[]
      }
      my_referral_progress: { Args: never; Returns: Json }
      notify_courier_offer_push: {
        Args: { _expert_id: string; _offer_id: string }
        Returns: undefined
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
      notify_customer_user_push: {
        Args: {
          _body: string
          _route: string
          _title: string
          _user_id: string
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
      notify_service_waiters: {
        Args: { _service_key: string }
        Returns: number
      }
      notify_waitlist_for_expert: {
        Args: { _expert_id: string }
        Returns: number
      }
      offers_audit: {
        Args: {
          _action: string
          _after: Json
          _before: Json
          _table: string
          _target: string
        }
        Returns: undefined
      }
      offers_caller_city: { Args: { _uid?: string }; Returns: string }
      offers_caller_role: { Args: { _uid?: string }; Returns: string }
      offers_require_writer: { Args: never; Returns: string }
      pan_key: { Args: never; Returns: string }
      partner_decide_extension: {
        Args: { _decision: string; _extension_id: string }
        Returns: Json
      }
      point_in_polygon: {
        Args: { _lat: number; _lng: number; _poly: Json }
        Returns: boolean
      }
      raise_dispatch_alert: {
        Args: { _booking_id: string; _type: string }
        Returns: boolean
      }
      reactivate_customer_after_otp: {
        Args: { _phone: string; _user_id: string }
        Returns: undefined
      }
      rebroadcast_pending_advance_to_expert: {
        Args: { _expert_id: string }
        Returns: number
      }
      record_booking_tip: {
        Args: {
          _amount: number
          _booking_id: string
          _razorpay_payment_id: string
        }
        Returns: string
      }
      register_device_token: {
        Args: { p_fcm_token: string; p_platform: string }
        Returns: string
      }
      release_stale_coupon_reservations: { Args: never; Returns: number }
      resolve_booking_payouts: {
        Args: { _booking_id: string }
        Returns: {
          area_partner_payout: number
          expert_payout: number
        }[]
      }
      resolve_caller_identity: {
        Args: { _auth_uid: string }
        Returns: {
          user_id: string
          user_type: string
        }[]
      }
      resolve_commission_split: {
        Args: {
          _duration_minutes: number
          _price: number
          _price_option_id: string
        }
        Returns: {
          expert_amount: number
          hourly_rate: number
          hq_amount: number
          partner_amount: number
          rule_id: string
        }[]
      }
      resolve_zone_for_point: {
        Args: { _lat: number; _lng: number }
        Returns: string
      }
      reward_apply_credit: {
        Args: {
          _actor_id: string
          _actor_type: string
          _event_ref: string
          _notes?: string
          _program: Database["public"]["Tables"]["reward_programs"]["Row"]
        }
        Returns: boolean
      }
      reward_check_expert_referral: {
        Args: { _expert_id: string }
        Returns: undefined
      }
      reward_gates_pass: {
        Args: {
          _condition: Json
          _end: string
          _expert_id: string
          _start: string
        }
        Returns: boolean
      }
      run_reward_period_jobs: {
        Args: { _force_period_start?: string }
        Returns: number
      }
      send_completion_reminders: { Args: never; Returns: number }
      send_scheduled_booking_reminders: { Args: never; Returns: number }
      service_can_order: {
        Args: { _at?: string; _service_key: string }
        Returns: boolean
      }
      service_effective_state: {
        Args: { _at?: string; _city?: string; _service_key: string }
        Returns: Json
      }
      service_holiday_notify: { Args: { _phase: string }; Returns: undefined }
      service_hours_autooffline: { Args: never; Returns: undefined }
      service_hours_bypass: { Args: never; Returns: boolean }
      service_next_open: {
        Args: { _flag_id: string; _from: string }
        Returns: string
      }
      service_slot_allowed: {
        Args: {
          _date: string
          _duration_minutes?: number
          _service_key: string
          _slot: string
        }
        Returns: Json
      }
      service_window: {
        Args: { _city?: string; _service_key: string }
        Returns: Json
      }
      set_login_pin: { Args: { p_pin: string }; Returns: undefined }
      slot_start_ist: {
        Args: { _date: string; _slot: string }
        Returns: string
      }
      staff_accept_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      staff_acknowledge_emergency_alert: {
        Args: { _alert_id: string; _notes?: string }
        Returns: undefined
      }
      staff_archive_reward_program: {
        Args: { _archived?: boolean; _id: string }
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
      staff_assign_partner_skill: {
        Args: { _expert_id: string; _service_category_id: string }
        Returns: string
      }
      staff_campaign_audience_preview:
        | { Args: { _audience: string }; Returns: Json }
        | {
            Args: { _audience: string; _target_user_ids?: string[] }
            Returns: Json
          }
      staff_cancel_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_clear_availability_override: {
        Args: { _target_id: string; _target_type: string }
        Returns: boolean
      }
      staff_clear_notifications: { Args: never; Returns: undefined }
      staff_close_service_today: {
        Args: { _reason?: string; _service_key: string; _until?: string }
        Returns: Json
      }
      staff_confirm_payout_batch: {
        Args: { _batch_id: string }
        Returns: undefined
      }
      staff_courier_confirm_rate: { Args: { _id: string }; Returns: undefined }
      staff_courier_force_cancel: {
        Args: { _order_id: string; _reason: string; _refund_amount?: number }
        Returns: Json
      }
      staff_courier_reassign_rider: {
        Args: { _expert_id: string; _order_id: string }
        Returns: Json
      }
      staff_courier_refund: {
        Args: { _amount: number; _order_id: string; _reason: string }
        Returns: Json
      }
      staff_courier_resolve_incident: {
        Args: {
          _order_id: string
          _pay_rider?: boolean
          _refund_amount?: number
          _resolution: string
        }
        Returns: Json
      }
      staff_courier_set_courier_type_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: undefined
      }
      staff_courier_set_service_flag: {
        Args: { _city: string; _is_active: boolean; _service_key: string }
        Returns: Json
      }
      staff_courier_set_vehicle_courier_type: {
        Args: {
          _courier_type_id: string
          _is_active: boolean
          _vehicle_type_id: string
        }
        Returns: undefined
      }
      staff_courier_set_vehicle_type_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: undefined
      }
      staff_courier_set_zones: {
        Args: { _city: string; _zone_ids: string[] }
        Returns: Json
      }
      staff_courier_upsert_courier_type: {
        Args: {
          _extra_fee: number
          _icon: string
          _id: string
          _instructions: string
          _is_active: boolean
          _name: string
          _sort_order: number
        }
        Returns: string
      }
      staff_courier_upsert_rate: {
        Args: {
          _base_fare: number
          _city: string
          _commission_pct: number
          _id: string
          _included_km: number
          _min_fare: number
          _per_km: number
          _platform_fee: number
          _vehicle_type_id: string
        }
        Returns: string
      }
      staff_courier_upsert_vehicle_type: {
        Args: {
          _exclusions: string[]
          _icon: string
          _id: string
          _inclusions: string[]
          _is_active: boolean
          _max_weight_kg: number
          _name: string
          _required_documents: string[]
          _required_skill: string
          _sort_order: number
        }
        Returns: string
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
      staff_delete_reward_program: {
        Args: { _force?: boolean; _id: string }
        Returns: undefined
      }
      staff_delete_service_catalogue_row: {
        Args: { _id: string }
        Returns: undefined
      }
      staff_discard_payout_batch: {
        Args: { _batch_id: string; _reason: string }
        Returns: undefined
      }
      staff_dismiss_notification: {
        Args: { _dismissed?: boolean; _id: string }
        Returns: undefined
      }
      staff_dispatch_failure_stats: {
        Args: { _from: string; _to: string }
        Returns: {
          day: string
          failures: number
          refunded: number
        }[]
      }
      staff_edit_booking: {
        Args: { _booking_id: string; _payload: Json }
        Returns: undefined
      }
      staff_expert_kyc_decision: {
        Args: { _decision: string; _expert_id: string; _reason: string }
        Returns: undefined
      }
      staff_export_raw_pan_tds_report: {
        Args: { _fy_start_year: number }
        Returns: {
          gross_total: number
          net_total: number
          owner_name: string
          owner_type: string
          pan: string
          tds_total: number
        }[]
      }
      staff_force_expert_offline: {
        Args: { _expert_id: string }
        Returns: undefined
      }
      staff_generate_merchant_payout_batch: { Args: never; Returns: string }
      staff_generate_payout_batch: { Args: never; Returns: string }
      staff_generate_subscription_invoices: { Args: never; Returns: Json }
      staff_list_notifications: {
        Args: { _filter?: string }
        Returns: {
          detail: string
          dismissed_at: string
          event_at: string
          id: string
          kind: string
          notif_key: string
          read_at: string
          target: string
          target_id: string
          title: string
          unread_total: number
        }[]
      }
      staff_mark_all_notifications_read: { Args: never; Returns: undefined }
      staff_mark_notification_read: {
        Args: { _id: string; _read?: boolean }
        Returns: undefined
      }
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
      staff_mark_tds_deposited: {
        Args: { _fy_start_year: number; _owner_id: string; _owner_type: string }
        Returns: number
      }
      staff_notify_waitlist_area: {
        Args: { _city?: string; _segment_id?: string }
        Returns: number
      }
      staff_permanently_delete_user: {
        Args: { _confirm_phone: string; _user_id: string }
        Returns: Json
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
      staff_remove_service_holiday: {
        Args: { _holiday_id: string }
        Returns: Json
      }
      staff_reopen_service_today: {
        Args: { _service_key: string }
        Returns: Json
      }
      staff_reorder_homepage_sections: {
        Args: { _orders: Json }
        Returns: undefined
      }
      staff_require_super_admin: { Args: never; Returns: undefined }
      staff_reverse_referral_reward: {
        Args: { _reason: string; _txn_id: string }
        Returns: undefined
      }
      staff_reverse_reward: {
        Args: { _ledger_id: string; _reason: string }
        Returns: undefined
      }
      staff_reward_ledger_search: {
        Args: {
          _actor_type?: string
          _from?: string
          _limit?: number
          _program_id?: string
          _search?: string
          _to?: string
        }
        Returns: {
          actor_id: string
          actor_name: string
          actor_phone: string
          actor_type: string
          credited_at: string
          id: string
          notes: string
          program_id: string
          program_name: string
          reversal_reason: string
          reversed_at: string
          reward_type: string
          reward_value: number
          status: string
          trigger_event_ref: string
        }[]
      }
      staff_reward_period_preview: {
        Args: { _period: string; _period_start: string }
        Returns: {
          active_days: number
          amount: number
          category: string
          expert_id: string
          expert_name: string
          hours: number
          orders: number
          program_id: string
          program_name: string
          qualifies: boolean
          reason: string
          slab: string
        }[]
      }
      staff_reward_program_stats: {
        Args: { _from?: string; _to?: string }
        Returns: {
          last_credited_at: string
          program_id: string
          reversed_count: number
          times_triggered: number
          total_value: number
        }[]
      }
      staff_run_reward_period_jobs: {
        Args: { _period_start?: string }
        Returns: number
      }
      staff_save_capacity_message: {
        Args: { _payload: Json }
        Returns: undefined
      }
      staff_send_campaign: { Args: { _id: string }; Returns: number }
      staff_send_support_message: {
        Args: { _body: string; _ticket_id: string }
        Returns: string
      }
      staff_set_app_versions: {
        Args: {
          _current_version?: string
          _latest_version_code?: number
          _min_supported_version?: string
          _min_supported_version_code?: number
          _play_store_url?: string
        }
        Returns: Json
      }
      staff_set_availability_override: {
        Args: {
          _is_unavailable: boolean
          _reason: string
          _target_id: string
          _target_type: string
          _unavailable_from: string
          _unavailable_until: string
        }
        Returns: string
      }
      staff_set_commission_rule_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: undefined
      }
      staff_set_coupon_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      staff_set_expert_zones: {
        Args: { _expert_id: string; _primary?: string; _zone_ids: string[] }
        Returns: undefined
      }
      staff_set_homepage_section_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      staff_set_last_order_buffer: {
        Args: { _minutes: number; _service_key: string }
        Returns: Json
      }
      staff_set_merchant_fee_tier: {
        Args: { _fee_tier_id: string; _merchant_id: string }
        Returns: undefined
      }
      staff_set_milestone_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      staff_set_ops_setting: {
        Args: { _key: string; _value: string }
        Returns: undefined
      }
      staff_set_pan: {
        Args: { _owner_id: string; _owner_type: string; _pan: string }
        Returns: undefined
      }
      staff_set_partner_zones: {
        Args: { _partner_id: string; _zone_ids: string[] }
        Returns: undefined
      }
      staff_set_reward_program_active: {
        Args: { _id: string; _is_active: boolean }
        Returns: undefined
      }
      staff_set_service_focus: {
        Args: {
          _live_service_key: string
          _message_en?: string
          _message_mr?: string
          _others_status?: string
        }
        Returns: Json
      }
      staff_set_service_holiday: {
        Args: {
          _end_date?: string
          _reason?: string
          _reason_mr?: string
          _service_key: string
          _start_date: string
        }
        Returns: Json
      }
      staff_set_service_hours: {
        Args: {
          _close_time: string
          _is_closed?: boolean
          _open_time: string
          _service_key: string
          _weekday: number
        }
        Returns: Json
      }
      staff_set_service_hours_enabled: {
        Args: { _enabled: boolean; _service_key: string }
        Returns: Json
      }
      staff_set_service_status: {
        Args: {
          _message_en?: string
          _message_mr?: string
          _resume_at?: string
          _service_key: string
          _status: string
        }
        Returns: Json
      }
      staff_set_staff_user_zones: {
        Args: { _staff_user_id: string; _zone_ids: string[] }
        Returns: undefined
      }
      staff_set_user_deleted: {
        Args: { _deleted: boolean; _user_id: string }
        Returns: Json
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
      staff_sync_notifications: { Args: never; Returns: undefined }
      staff_tds_report: {
        Args: { _fy_start_year: number }
        Returns: {
          deposited_total: number
          gross_total: number
          items: number
          net_total: number
          owner_id: string
          owner_name: string
          owner_type: string
          pan_last4: string
          tds_total: number
        }[]
      }
      staff_undo_service_focus: { Args: { _undo_token: string }; Returns: Json }
      staff_update_booking_status: {
        Args: { _booking_id: string; _new_status: string; _note?: string }
        Returns: undefined
      }
      staff_update_deletion_request: {
        Args: { _note?: string; _request_id: string; _status: string }
        Returns: undefined
      }
      staff_update_dispatch_config: {
        Args: { _payload: Json }
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
      staff_update_support_ticket: {
        Args: {
          _note?: string
          _resolution?: string
          _resolution_outcome?: string
          _status: string
          _ticket_id: string
        }
        Returns: undefined
      }
      staff_update_user: {
        Args: {
          _email: string
          _full_name: string
          _preferred_language: string
          _user_id: string
        }
        Returns: Json
      }
      staff_update_zone: {
        Args: { _payload: Json; _zone_id: string }
        Returns: undefined
      }
      staff_upsert_area_partner: { Args: { _payload: Json }; Returns: string }
      staff_upsert_campaign: {
        Args: {
          _audience: string
          _body: string
          _coupon_id: string
          _deep_link: string
          _id: string
          _image_url: string
          _show_in_offers: boolean
          _target_user_ids?: string[]
          _title: string
        }
        Returns: string
      }
      staff_upsert_commission_rule: {
        Args: {
          _expert_type: string
          _expert_value: number
          _id: string
          _is_active: boolean
          _min_hq_share: number
          _notes: string
          _partner_type: string
          _partner_value: number
          _price_option_id: string
          _scope: string
        }
        Returns: string
      }
      staff_upsert_coupon: {
        Args: {
          _audience: string
          _code: string
          _description: string
          _discount_type: string
          _discount_value: number
          _id: string
          _max_discount: number
          _min_order_amount: number
          _per_user_limit: number
          _title: string
          _total_usage_limit: number
          _valid_from: string
          _valid_until: string
        }
        Returns: string
      }
      staff_upsert_expert: { Args: { _payload: Json }; Returns: string }
      staff_upsert_fee_tier: { Args: { _payload: Json }; Returns: string }
      staff_upsert_homepage_section: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_upsert_legal_page: { Args: { _payload: Json }; Returns: string }
      staff_upsert_milestone_program: {
        Args: {
          _description: string
          _id: string
          _name: string
          _required_referrals: number
          _reward_discount_type: string
          _reward_discount_value: number
          _reward_max_discount: number
          _reward_min_order_amount: number
          _reward_validity_days: number
        }
        Returns: string
      }
      staff_upsert_notification_sound: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_upsert_reward_program: {
        Args: {
          _actor_type: string
          _condition: Json
          _id: string
          _is_active: boolean
          _name: string
          _recurrence: string
          _reward_type: string
          _reward_value: number
          _trigger_type: string
          _valid_from: string
          _valid_until: string
        }
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
      staff_zone_ids: { Args: { _auth_user_id: string }; Returns: string[] }
      start_service: { Args: { _booking_id: string }; Returns: string }
      store_is_open_now: { Args: { _merchant_id: string }; Returns: boolean }
      store_max_radius_km: { Args: never; Returns: number }
      submit_booking_review: {
        Args: { _booking_id: string; _rating: number; _review: string }
        Returns: undefined
      }
      support_mark_ticket_read: {
        Args: { _ticket_id: string }
        Returns: undefined
      }
      system_accept_booking_after_payment: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      system_auto_cancel_booking_no_expert: {
        Args: {
          _booking_id: string
          _refund_amount: number
          _refund_id: string
          _refund_status: string
        }
        Returns: Json
      }
      system_check_no_accept_alerts: { Args: never; Returns: string[] }
      system_coupon_release: { Args: { _order_id: string }; Returns: undefined }
      system_coupon_reserve: {
        Args: {
          _base_amount: number
          _code: string
          _duration_minutes: number
          _order_id: string
          _user_id: string
        }
        Returns: Json
      }
      system_credit_referral_for_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      system_fulfill_payment_intent: {
        Args: { _order_id: string; _payment_id: string }
        Returns: string
      }
      system_list_expired_unassigned_bookings: {
        Args: never
        Returns: {
          broadcast_started_at: string
          created_at: string
          id: string
          price: number
          razorpay_payment_id: string
        }[]
      }
      system_mark_dispatch_whatsapp: {
        Args: { _event_id: string }
        Returns: undefined
      }
      system_mark_waitlist_whatsapp: {
        Args: { _event_id: string }
        Returns: undefined
      }
      system_pending_dispatch_whatsapp: {
        Args: never
        Returns: {
          alert_type: string
          booking_id: string
          city: string
          event_id: string
          numbers: string[]
          service_label: string
          template_name: string
        }[]
      }
      system_pending_waitlist_whatsapp: {
        Args: never
        Returns: {
          city: string
          customer_name: string
          event_id: string
          numbers: string[]
          phone: string
          template_name: string
        }[]
      }
      system_send_marketing_campaign: {
        Args: { _campaign_id: string }
        Returns: number
      }
      system_set_booking_refund_state: {
        Args: {
          _booking_id: string
          _refund_amount?: number
          _refund_attempts?: number
          _refund_error?: string
          _refund_id?: string
          _refund_next_attempt_at?: string
          _refund_status: string
        }
        Returns: undefined
      }
      verify_commission_parity: {
        Args: never
        Returns: {
          customer_price: number
          label: string
          legacy_expert: number
          legacy_partner: number
          matches: boolean
          new_expert: number
          new_partner: number
          price_option_id: string
        }[]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
