import React from "react";
import { Link } from "react-router-dom";
import { UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PROFILE_REQUIRED_TITLE, PROFILE_REQUIRED_MESSAGE } from "@/lib/profileGuard";

/** Shown instead of building a basket / menu when the profile is missing (src/lib/profileGuard.js). */
export default function ProfileRequiredNotice() {
  return (
    <Card className="p-8 text-center border-amber-300 bg-amber-50/50" role="alert" data-testid="profile-required">
      <UserRound className="w-10 h-10 text-amber-600 mx-auto mb-3" />
      <h2 className="font-heading font-semibold text-lg mb-2">{PROFILE_REQUIRED_TITLE}</h2>
      <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">{PROFILE_REQUIRED_MESSAGE}</p>
      <Button asChild className="rounded-full">
        <Link to="/onboarding">להשלמת הפרופיל</Link>
      </Button>
    </Card>
  );
}
