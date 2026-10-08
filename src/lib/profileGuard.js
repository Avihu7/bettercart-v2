/**
 * The smart basket and the weekly menu are built for a person: their nutrition
 * goals, diet, allergies, favorite and disliked foods and budget. Without a
 * completed profile (onboarding) neither is built — never with silent defaults,
 * which give a menu that ignores the user's preferences and has no quality card.
 */

export const PROFILE_REQUIRED_TITLE = "צריך להשלים את הפרופיל קודם";
export const PROFILE_REQUIRED_MESSAGE =
  "כדי לבנות סל חכם ותפריט שבועי אנחנו צריכים את יעדי התזונה, ההעדפות, המזונות האהובים והתקציב שלך. השלימו את שאלון ההיכרות ואז נבנה את הסל והתפריט.";

export class ProfileRequiredError extends Error {
  constructor() {
    super(PROFILE_REQUIRED_MESSAGE);
    this.name = "ProfileRequiredError";
    this.code = "profile_required";
  }
}

/** A profile that finished onboarding and has nutrition goals. */
export function profileReady(profile) {
  return !!profile && profile.onboarding_complete !== false &&
    Number(profile.daily_calories) > 0 && Number(profile.protein_target) > 0;
}

/** Throws ProfileRequiredError unless the profile is ready. */
export function requireProfile(profile) {
  if (!profileReady(profile)) throw new ProfileRequiredError();
}
