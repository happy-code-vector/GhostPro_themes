import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@3.2.0";

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

const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

// Initialize Resend
const resend = new Resend(RESEND_API_KEY);

// Helper function to generate a secure token
function generateMagicToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

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

    // 2. Generate magic link token and store it
    const magicToken = generateMagicToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    
    // Store the magic token in database
    const { error: tokenError } = await supabaseAdmin
      .from("magic_tokens")
      .upsert({
        email: normalizedEmail,
        token: magicToken,
        expires_at: expiresAt.toISOString(),
        used: false,
      }, { onConflict: "email" });

    if (tokenError) {
      console.error("Token storage error:", tokenError);
      throw new Error("Failed to generate magic link");
    }

    // 3. Send magic link email via Resend
    const magicLink = `https://prepared-mind.ghost.io/?token=${magicToken}&email=${encodeURIComponent(normalizedEmail)}`;
    
    try {
      const { error: emailError } = await resend.emails.send({
        from: "hello@support.preparedmind.ai",
        to: [normalizedEmail],
        subject: "Your magic link to access Prepared Mind",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="min-width: 100%; background-color: #f4f4f4;">
              <tr>
                <td align="center" style="padding: 48px 24px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);">
                    <tr>
                      <td style="padding: 48px 40px;">
                        <!-- Header -->
                        <h1 style="margin: 0 0 24px 0; font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; color: #15171a;">
                          Welcome to Prepared Mind
                        </h1>
                        
                        <!-- Body text -->
                        <p style="margin: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: #505050;">
                          Click the button below to securely access your account. This magic link will sign you in instantly.
                        </p>
                        
                        <!-- CTA Button -->
                        <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin: 0 0 32px 0;">
                          <tr>
                            <td align="center">
                              <a href="${magicLink}" 
                                 style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; line-height: 1; color: #ffffff; text-decoration: none; border-radius: 100px; background-color: #3db4f2;">
                                Access Prepared Mind
                              </a>
                            </td>
                          </tr>
                        </table>
                        
                        <!-- Expiry notice -->
                        <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5; color: rgba(0, 0, 0, 0.55);">
                          This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.
                        </p>
                        
                        <!-- Fallback link -->
                        <div style="padding-top: 24px; border-top: 1px solid rgba(0, 0, 0, 0.08);">
                          <p style="margin: 0; font-size: 13px; line-height: 1.5; color: rgba(0, 0, 0, 0.55);">
                            If the button doesn't work, copy and paste this link into your browser:
                          </p>
                          <p style="margin: 8px 0 0 0; font-size: 13px; line-height: 1.5; word-break: break-all; color: #15171a;">
                            ${magicLink}
                          </p>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Footer -->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px;">
                    <tr>
                      <td style="padding: 24px 40px; text-align: center;">
                        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: rgba(0, 0, 0, 0.4);">
                          © ${new Date().getFullYear()} Prepared Mind. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `,
      });

      if (emailError) {
        console.error("Resend email error:", emailError);
        throw new Error("Failed to send magic link email");
      }
    } catch (resendError) {
      console.error("Resend error:", resendError);
      throw new Error("Failed to send magic link email");
    }

    // 4. Sync to HubSpot as MQL with beta_icp_list flag
    if (!existingUser || existingUser.status === "tier1") {
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
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Magic link sent to your email. Check your inbox and click the link to access Prepared Mind." 
      }),
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
