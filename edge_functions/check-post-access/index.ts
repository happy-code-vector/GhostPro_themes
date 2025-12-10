import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIMIT_TIER1 = 1;
const LIMIT_TIER2 = 3;

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { post_slug, user_email } = await req.json();
    
    if (!post_slug) {
      return new Response(
        JSON.stringify({ error: "Missing post_slug" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!user_email) {
      return new Response(
        JSON.stringify({ error: "Missing user_email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userEmail = user_email.toLowerCase().trim();

    // Use service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get user status from allowed_users
    const { data: allowedUser, error: allowedError } = await supabase
      .from("allowed_users")
      .select("status")
      .eq("email", userEmail)
      .single();

    if (allowedError || !allowedUser) {
      return new Response(
        JSON.stringify({ 
          can_access: false, 
          reason: "not_allowed",
          message: "User not in allowed list"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userStatus = allowedUser.status;

    // 2. VIP gets unlimited access
    if (userStatus === "vip") {
      return new Response(
        JSON.stringify({ can_access: true, reason: "vip" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check if user already unlocked this specific post
    const { data: existingUnlock } = await supabase
      .from("user_unlocks")
      .select("id")
      .eq("user_email", userEmail)
      .eq("post_slug", post_slug)
      .single();

    if (existingUnlock) {
      return new Response(
        JSON.stringify({ can_access: true, reason: "already_unlocked" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Count how many posts user has unlocked
    const { count: unlockCount } = await supabase
      .from("user_unlocks")
      .select("*", { count: "exact", head: true })
      .eq("user_email", userEmail);

    const currentUnlocks = unlockCount || 0;

    // 5. Determine limit based on tier
    let limit = 0;
    if (userStatus === "tier1") {
      limit = LIMIT_TIER1;
    } else if (userStatus === "tier2") {
      limit = LIMIT_TIER2;
    }

    // 6. Check if under limit
    if (currentUnlocks < limit) {
      // Unlock this post for the user
      await supabase
        .from("user_unlocks")
        .insert({ user_email: userEmail, post_slug: post_slug });

      return new Response(
        JSON.stringify({ can_access: true, reason: "newly_unlocked" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. User is at or over limit
    if (userStatus === "tier1") {
      return new Response(
        JSON.stringify({ can_access: false, reason: "tier1_limit" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (userStatus === "tier2") {
      return new Response(
        JSON.stringify({ can_access: false, reason: "tier2_limit" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ can_access: false, reason: "unknown_status" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
