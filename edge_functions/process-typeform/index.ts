import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;

serve(async (req) => {
  try {
    const body = await req.json();
    const email = body.form_response.hidden.email;
    const sector = body.form_response.answers[0].text;
    const nps = body.form_response.answers[1].number;

    // 1. Update Supabase
    await supabase.from("allowed_users")
      .update({ status: "tier2" })
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
          tier_status: "tier2",
          sector_interest: sector,
          nps_score: nps,
        },
      }),
    });

    return new Response("OK", { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
