import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Service role client for database operations
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Anon client for sending OTP (uses Supabase's built-in email)
const supabaseAnon = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!
);

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, source } = await req.json();

    // Validate email
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Valid email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Downgrade Protection: Check if user already exists with higher tier
    const { data: existingUser } = await supabaseAdmin
      .from("allowed_users")
      .select("status")
      .eq("email", normalizedEmail)
      .single();

    // Only create/update if user doesn't exist OR is not already tier2/vip
    if (!existingUser || existingUser.status === "tier1") {
      await supabaseAdmin.from("allowed_users").upsert(
        {
          email: normalizedEmail,
          status: "tier1",
          unlocks_count: 0,
          source: source ?? "inbound",
          founder_led_mql: true,
        },
        { onConflict: "email" }
      );
    }

    // 2. Send Magic Link via signInWithOtp (Supabase sends email automatically)
    const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: "https://prepared-mind.ghost.io",
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      console.error("OTP error:", otpError);
      throw new Error(otpError.message);
    }

    // 3. Sync to HubSpot as MQL with beta_icp_list flag
    try {
      const hubspotProperties = {
        email: normalizedEmail,
        lifecyclestage: "marketingqualifiedlead",
        tier_status: "tier1",
        beta_icp_list: "true",
        founder_led_mql: "true",
        lead_source: "inbound",
      };

      // First try to create the contact
      const createResponse = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties: hubspotProperties }),
      });

      // If contact already exists (409 Conflict), update instead
      if (createResponse.status === 409) {
        console.log("HubSpot: Contact exists, updating...");
        // Search for existing contact by email
        const searchResponse = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/search`,
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
          // Update existing contact (don't overwrite lifecyclestage if already higher)
          const { lifecyclestage, ...updateProps } = hubspotProperties;
          await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${HUBSPOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ properties: updateProps }),
            }
          );
          console.log("HubSpot: Contact updated", contactId);
        }
      } else if (!createResponse.ok) {
        const errorData = await createResponse.text();
        console.error("HubSpot create error:", createResponse.status, errorData);
      } else {
        console.log("HubSpot: Contact created");
      }
    } catch (hubspotError) {
      // Don't fail the request if HubSpot sync fails
      console.error("HubSpot sync error:", hubspotError);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Magic link sent to your email" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("invite-user error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
