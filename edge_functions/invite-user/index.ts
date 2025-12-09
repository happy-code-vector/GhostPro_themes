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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

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
          source: source ?? "inbound",
          founder_led_mql: true,
        },
        { onConflict: "email" }
      );
    }

    // 2. Generate Magic Link
    const { data, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: normalizedEmail,
      options: {
        redirectTo: "https://prepared-mind.ghost.io",
      },
    });

    if (linkError) {
      throw new Error(linkError.message);
    }

    const magicLink = data?.properties?.action_link;
    if (!magicLink) {
      throw new Error("Failed to generate magic link");
    }

    // 3. Send magic link email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Prepared Mind <noreply@preparedmind.co>",
        to: [normalizedEmail],
        subject: "Your Access Link to Prepared Mind",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #15171a;">Welcome to Prepared Mind</h2>
            <p>Click the button below to access your intelligence briefing:</p>
            <a href="${magicLink}" 
               style="display: inline-block; background: #3db4f2; color: white; padding: 14px 28px; 
                      text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0;">
              Access Briefing
            </a>
            <p style="color: #666; font-size: 14px;">
              This link expires in 24 hours. If you didn't request this, you can safely ignore this email.
            </p>
            <p style="color: #666; font-size: 14px;">
              Or copy this link: <br>
              <a href="${magicLink}" style="color: #3db4f2; word-break: break-all;">${magicLink}</a>
            </p>
          </div>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const emailError = await emailResponse.text();
      console.error("Resend error:", emailError);
      throw new Error("Failed to send email");
    }

    // 4. Link user_id to allowed_users if we have it
    if (data?.user?.id) {
      await supabase
        .from("allowed_users")
        .update({ user_id: data.user.id })
        .eq("email", normalizedEmail);
    }

    // 5. Sync to HubSpot as MQL with beta_icp_list flag
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
          lead_source: "Inbound",
        },
      }),
    });

    return new Response(
      JSON.stringify({ success: true, message: "Magic link sent" }),
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
