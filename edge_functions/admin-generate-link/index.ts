import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-email",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") || "").split(",");

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const adminEmail = req.headers.get("x-admin-email");
    if (!ADMIN_EMAILS.includes(adminEmail!)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, promo_report_slug } = await req.json();

    // 1. Upsert outbound user
    await supabase.from("allowed_users").upsert({
      email,
      status: "tier1",
      unlocks_count: 0,
      source: "outbound",
    });

    // 2. Generate Magic Link with optional promo redirect
    let redirectUrl = "https://preparedmind.co/library";
    if (promo_report_slug) {
      redirectUrl = `https://preparedmind.co/${promo_report_slug}?promo_report=${promo_report_slug}`;
    }

    const { data } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: redirectUrl },
    });

    // 3. Sync to HubSpot
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          email,
          tier_status: "tier1",
          beta_icp_list: true,
          founder_led_mql: true,
        },
      }),
    });

    // 4. Log link generation for audit
    await supabase.from("admin_audit_log").insert({
      admin_email: adminEmail,
      action: "generate_link",
      target_email: email,
      promo_report_slug: promo_report_slug || null,
    });

    return new Response(JSON.stringify({ link: data.user?.action_link }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
