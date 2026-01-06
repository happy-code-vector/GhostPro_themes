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
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let email: string | null = null;
    let tier_status: string | null = null;

    // Handle both GET (redirect-based) and POST (webhook-based)
    if (req.method === "GET") {
      const url = new URL(req.url);
      email = url.searchParams.get("email");
      tier_status = url.searchParams.get("tier_status");
    } else {
      const body = await req.json();
      email = body.email || 
              body.payload?.email || 
              body.payload?.invitee?.email ||
              body.invitee?.email;
      tier_status = body.tier_status || body.payload?.tier_status;
    }

    if (!email) {
      console.error("upgrade-to-vip: Missing email");
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tier_status) {
      console.error("upgrade-to-vip: Missing tier_status");
      return new Response(JSON.stringify({ error: "Tier status is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check if user exists with same email but different tier status
    const { data: existingUser, error: selectError } = await supabase
      .from("allowed_users")
      .select("*")
      .eq("email", normalizedEmail)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error("upgrade-to-vip: Database select error", selectError);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user exists and has different tier status
    if (!existingUser) {
      console.log("upgrade-to-vip: No existing user found with email", normalizedEmail);
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (existingUser.status === tier_status) {
      console.log("upgrade-to-vip: User already has the same tier status", { email: normalizedEmail, tier_status });
      return new Response(JSON.stringify({ message: "User already has the same tier status" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Update Supabase with new tier status
    const { error: updateError } = await supabase
      .from("allowed_users")
      .update({ 
        status: tier_status,
        updated_at: new Date().toISOString(),
      })
      .eq("email", normalizedEmail);

    if (updateError) {
      console.error("upgrade-to-vip: Supabase update error", updateError);
      return new Response(JSON.stringify({ error: "Failed to update user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Send email notification for tier status change
    try {
      const isVipUpgrade = tier_status.toLowerCase() === "vip";
      const emailSubject = isVipUpgrade ? "🎉 Welcome to VIP Access!" : `📋 Your Account Status Has Been Updated`;
      
      const vipContent = {
        title: "🎉 Congratulations!",
        message: `Great news! Your account has been upgraded to <strong>VIP status</strong>.`,
        benefits: `
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Your VIP Benefits Include:</h3>
            <ul style="color: #555; line-height: 1.8;">
              <li>Unlimited access to all premium features</li>
              <li>Priority customer support</li>
              <li>Early access to new features</li>
              <li>Exclusive VIP content and resources</li>
            </ul>
          </div>
        `,
        cta: `
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://yourdomain.com/dashboard" 
               style="background-color: #007bff; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Access Your VIP Dashboard
            </a>
          </div>
        `,
        textVersion: `
Congratulations! Your account has been upgraded to VIP status.

Your VIP Benefits Include:
- Unlimited access to all premium features
- Priority customer support  
- Early access to new features
- Exclusive VIP content and resources

You can start enjoying your VIP benefits immediately. If you have any questions, don't hesitate to reach out to our support team.

Thank you for being a valued member!
        `.trim()
      };

      const nonVipContent = {
        title: "📋 Account Status Updated",
        message: `Your account status has been updated to <strong>${tier_status}</strong>.`,
        benefits: `
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Account Details:</h3>
            <p style="color: #555; line-height: 1.8; margin: 0;">
              <strong>Previous Status:</strong> ${existingUser.status}<br>
              <strong>New Status:</strong> ${tier_status}<br>
              <strong>Updated:</strong> ${new Date().toLocaleDateString()}
            </p>
          </div>
        `,
        cta: `
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://yourdomain.com/dashboard" 
               style="background-color: #6c757d; color: white; padding: 12px 24px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              View Your Dashboard
            </a>
          </div>
        `,
        textVersion: `
Your account status has been updated to ${tier_status}.

Account Details:
- Previous Status: ${existingUser.status}
- New Status: ${tier_status}
- Updated: ${new Date().toLocaleDateString()}

If you have any questions about this change, please contact our support team.

Thank you for being a valued member!
        `.trim()
      };

      const content = isVipUpgrade ? vipContent : nonVipContent;

      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "hello@support.preparedmind.ai",
          to: [normalizedEmail],
          subject: emailSubject,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #333; text-align: center;">${content.title}</h1>
              <p style="font-size: 16px; line-height: 1.6; color: #555;">
                ${content.message}
              </p>
              ${content.benefits}
              <p style="font-size: 16px; line-height: 1.6; color: #555;">
                ${isVipUpgrade 
                  ? 'You can start enjoying your VIP benefits immediately. If you have any questions, don\'t hesitate to reach out to our support team.' 
                  : 'If you have any questions about this change, please contact our support team.'
                }
              </p>
              ${content.cta}
              <p style="font-size: 14px; color: #888; text-align: center; margin-top: 30px;">
                Thank you for being a valued member!
              </p>
            </div>
          `,
          text: content.textVersion,
        }),
      });

      if (emailResponse.ok) {
        const emailData = await emailResponse.json();
        console.log("Tier status change email sent successfully:", emailData.id);
      } else {
        const errorData = await emailResponse.text();
        console.error("Failed to send tier status change email:", errorData);
      }
    } catch (emailError) {
      console.error("Email sending error:", emailError);
    }

    console.log("upgrade-to-vip: User tier status updated", { 
      email: normalizedEmail, 
      old_status: existingUser.status, 
      new_status: tier_status 
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Tier status updated successfully",
        old_status: existingUser.status,
        new_status: tier_status
      }),
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
