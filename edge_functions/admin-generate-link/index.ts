import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;
const ADMIN_EMAILS = (Deno.env.get("ADMIN_EMAILS") || "").split(",");

serve(async (req) => {
  try {
    const adminEmail = req.headers.get("x-admin-email");
    if (!ADMIN_EMAILS.includes(adminEmail!)) {
      return new Response("Forbidden", { status: 403 });
    }

    const { email } = await req.json();

    // 1. Upsert outbound user
    await supabase.from("allowed_users").upsert({
      email,
      status: "tier1",
      unlocks_count: 0,
      source: "outbound",
    });

    // 2. Generate Magic Link
    const { data } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
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

    return new Response(JSON.stringify({ link: data.user?.action_link }), {
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
