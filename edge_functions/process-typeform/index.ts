import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Per TRD: hidden field is 'user_email' passed from Wall #1
    const email = body.form_response?.hidden?.user_email || body.form_response?.hidden?.email;
    
    if (!email) {
      console.error("process-typeform: Missing email in hidden fields", body.form_response?.hidden);
      return new Response(JSON.stringify({ error: "Missing user email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Parse sector_interest and nps_score from Typeform payload
    // Handle different answer formats
    let sector = "";
    let nps = 0;

    const answers = body.form_response?.answers || [];
    for (const answer of answers) {
      if (answer.type === "text" || answer.type === "choice") {
        sector = answer.text || answer.choice?.label || "";
      } else if (answer.type === "number" || answer.type === "opinion_scale") {
        nps = answer.number || 0;
      }
    }

    // 1. Upgrade to tier2 in Supabase (unlocks_count is preserved, NOT reset)
    const { error: updateError } = await supabase
      .from("allowed_users")
      .update({ 
        status: "tier2",
        updated_at: new Date().toISOString(),
      })
      .eq("email", normalizedEmail);

    if (updateError) {
      console.error("process-typeform: Supabase update error", updateError);
    }

    // 2. Enrich HubSpot record with sector/NPS data
    await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          email: normalizedEmail,
          tier_status: "tier2",
          sector_interest: sector,
          nps_score: String(nps),
        },
      }),
    });

    console.log("process-typeform: Upgraded to tier2", { email: normalizedEmail, sector, nps });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-typeform error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
