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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let email: string | null = null;

    // Handle both GET (redirect-based) and POST (webhook-based)
    // Option A: Calendly redirect with email param
    // Option B: Calendly webhook on 'invitee.created' event
    if (req.method === "GET") {
      const url = new URL(req.url);
      email = url.searchParams.get("email");
    } else {
      const body = await req.json();
      // Support multiple Calendly webhook payload formats
      email = body.email || 
              body.payload?.email || 
              body.payload?.invitee?.email ||
              body.invitee?.email;
    }

    if (!email) {
      console.error("upgrade-to-vip: Missing email");
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Update Supabase to VIP (unlimited access)
    const { error: updateError } = await supabase
      .from("allowed_users")
      .update({ 
        status: "vip",
        updated_at: new Date().toISOString(),
      })
      .eq("email", normalizedEmail);

    if (updateError) {
      console.error("upgrade-to-vip: Supabase update error", updateError);
    }

    // 2. Update HubSpot lifecycle stage to SQL (update existing contact)
    try {
      // Search for existing contact by email
      const searchResponse = await fetch(
        "https://api.hubapi.com/crm/v3/objects/contacts/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HUBSPOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filterGroups: [{
              filters: [{
                propertyName: "email",
                operator: "EQ",
                value: normalizedEmail,
              }],
            }],
          }),
        }
      );

      const searchData = await searchResponse.json();
      if (searchData.results && searchData.results.length > 0) {
        const contactId = searchData.results[0].id;
        // Update existing contact to VIP/SQL
        await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              properties: {
                tier_status: "vip",
                lifecyclestage: "salesqualifiedlead",
              },
            }),
          }
        );
        console.log("HubSpot: Contact upgraded to VIP/SQL", contactId);
      } else {
        console.log("HubSpot: Contact not found for", normalizedEmail);
      }
    } catch (hubspotError) {
      console.error("HubSpot sync error:", hubspotError);
    }

    console.log("upgrade-to-vip: User upgraded to VIP", { email: normalizedEmail });

    return new Response(
      JSON.stringify({ success: true, message: "VIP access granted" }),
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
