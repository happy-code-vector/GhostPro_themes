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
    const email =
      body.email || body.payload?.email || body.payload?.invitee?.email;

    if (!email) {
      return new Response("invalid email", { status: 400 });
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
        },
      }),
    });

    return new Response("VIP updated");
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
