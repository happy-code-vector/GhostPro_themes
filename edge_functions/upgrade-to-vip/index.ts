import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let email: string | null = null;
    let tier_status: string | null = null;

    // Handle both GET (redirect-based) and POST (webhook-based)
    if (req.method === "GET") {
      const url = new URL(req.url);
      email = url.searchParams.get("email");
      tier_status = url.searchParams.get("tier_status");
    } else {
      const body = await req.json();
      email = body.email || 
              body.payload?.email || 
              body.payload?.invitee?.email ||
              body.invitee?.email;
      tier_status = body.tier_status || body.payload?.tier_status;
    }

    if (!email) {
      console.error("upgrade-to-vip: Missing email");
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tier_status) {
      console.error("upgrade-to-vip: Missing tier_status");
      return new Response(JSON.stringify({ error: "Tier status is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check if user exists with same email but different tier status
    const { data: existingUser, error: selectError } = await supabase
      .from("allowed_users")
      .select("*")
      .eq("email", normalizedEmail)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error("upgrade-to-vip: Database select error", selectError);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user exists and has different tier status
    if (!existingUser) {
      console.log("upgrade-to-vip: No existing user found with email", normalizedEmail);
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingUser.status === tier_status) {
      console.log("upgrade-to-vip: User already has the same tier status", { email: normalizedEmail, tier_status });
      return new Response(JSON.stringify({ message: "User already has the same tier status" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Update Supabase with new tier status
    const { error: updateError } = await supabase
      .from("allowed_users")
      .update({ 
        status: tier_status,
        updated_at: new Date().toISOString(),
      })
      .eq("email", normalizedEmail);

    if (updateError) {
      console.error("upgrade-to-vip: Supabase update error", updateError);
      return new Response(JSON.stringify({ error: "Failed to update user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("upgrade-to-vip: User tier status updated", { 
      email: normalizedEmail, 
      old_status: existingUser.status, 
      new_status: tier_status 
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Tier status updated successfully",
        old_status: existingUser.status,
        new_status: tier_status
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("upgrade-to-vip error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
