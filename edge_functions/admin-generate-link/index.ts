import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-email",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map((e) => e.trim().toLowerCase());

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Security: Verify admin email
    const adminEmail = req.headers.get("x-admin-email")?.toLowerCase().trim();
    if (!adminEmail || !ADMIN_EMAILS.includes(adminEmail)) {
      console.error("Forbidden: Invalid admin email", adminEmail);
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, promo_report_slug } = await req.json();

    // Validate email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Downgrade Protection: Check if user already exists with higher tier
    const { data: existingUser } = await supabase
      .from("allowed_users")
      .select("status")
      .eq("email", normalizedEmail)
      .single();

    // Only create/update if user doesn't exist OR is not already tier2/vip
    if (!existingUser || existingUser.status === "tier1") {
      await supabase.from("allowed_users").upsert(
        {
          email: normalizedEmail,
          status: "tier1",
          unlocks_count: 0,
          source: "outbound",
          founder_led_mql: true,
        },
        { onConflict: "email" }
      );
    }

    // 2. Generate Magic Link with optional promo redirect (Golden Ticket)
    let redirectUrl = "https://prepared-mind.ghost.io/library";
    if (promo_report_slug) {
      redirectUrl = `https://prepared-mind.ghost.io/${promo_report_slug}?promo_report=${promo_report_slug}`;
    }

    const { data, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: { redirectTo: redirectUrl },
    });

    if (linkError) {
      throw new Error(linkError.message);
    }

    // 3. Link user_id to allowed_users if we have it
    if (data?.user?.id) {
      await supabase
        .from("allowed_users")
        .update({ user_id: data.user.id })
        .eq("email", normalizedEmail);
    }

    // 4. Sync to HubSpot as Outbound lead
    await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          email: normalizedEmail,
          lifecyclestage: "marketingqualifiedlead",
          tier_status: "tier1",
          beta_icp_list: "true",
          founder_led_mql: "true",
          lead_source: "Outbound",
        },
      }),
    });

    // 5. Log link generation for audit trail
    await supabase.from("admin_audit_log").insert({
      admin_email: adminEmail,
      action: "generate_link",
      target_email: normalizedEmail,
      promo_report_slug: promo_report_slug || null,
      created_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        link: data?.user?.action_link,
        message: "Magic link generated"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("admin-generate-link error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
