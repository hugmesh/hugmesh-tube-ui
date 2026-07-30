# USER-SITUATIONAL coverage — the My Tube player's HONEST-FAILURE promise for the
# 5-minute signed-URL TTL: a sign 403/expired must show an error + a Retry, never a
# broken <video>. The step for it was already written in tube-steps.ts but referenced
# by NO feature. This wires it: a `done` job renders a Load button, but GET
# /bff/tube/media/sign is stubbed to 403, so the card must transition to the
# error+retry state (tube-watch-error-* + tube-watch-retry-*, no tube-watch-video-*).
#
# Pure client-side error rendering, so a SEEDED session + route interception serves
# the exact queue row + the 403 sign response deterministically (no real write).
#
# @cluster — this harness has no offline app server (the served remote shell is
# still required); interception replaces the tube-bff (no live tube-bff needed).
@cluster @tube-ui @user-situational
Feature: My Tube player — a failed media sign shows error + retry, never a broken player
  As a Tube user
  I want a failed media-sign to show an error and a retry
  So I never see a broken video player when the signed URL is rejected or expired

  Scenario: a 403 from the media-sign endpoint yields an error and a retry, no <video>
    Given "tube-user" has a seeded session
    And a completed download "job-sign-fail" is present but its media sign returns 403
    When "tube-user" navigates to "/tube/my"
    And "tube-user" tries to load the video for the completed download "job-sign-fail"
    Then "tube-user" sees a retry instead of a broken player for "job-sign-fail"
