import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let email: string | null = null;

    // Handle both GET (redirect-based) and POST (webhook-based)
    if (req.method === "GET") {
      const url = new URL(req.url);
      email = url.searchParams.get("email");
    } else {
      const body = await req.json();
      email = body.email || body.payload?.email || body.payload?.invitee?.email;
    }

    if (!email) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Update Supabase to VIP
    await supabase.from("allowed_users")
      .update({ status: "vip" })
      .eq("email", email);

    // 2. Update HubSpot
    await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          email,
          tier_status: "vip",
          lifecyclestage: "salesqualifiedlead",
        },
      }),
    });

    return new Response(JSON.stringify({ success: true, message: "VIP updated" }), {
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
