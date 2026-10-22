# OFFLINE MOCKED-BACKEND lane — MFA step-up on the Tube admin write calls.
#
# On an mfa_required deny the GATEWAY (not tube-bff) answers 403 + X-Route-Denied +
# X-Step-Up-Required: X-Mfa-StepUp with an empty body, only when a fresh second
# factor is the one thing missing. The console must then show the inline MFA
# challenge, post it to POST /bff/mfa/challenge, and retry the SAME call once.
#
# What this proves: the console's behaviour against those wire shapes, RENDERED —
# the dialog is visible with a real box inside the viewport (a unit spec cannot see
# an invisible dialog). What it cannot prove: that the gateway really emits the
# header or that /bff/mfa/challenge stamps the session. That needs a live mesh with
# app.mfa.enabled and app.mfa.enforce-privileged-floor on.
@mock @tube-ui @user-situational
Feature: Tube admin step-up (mocked backend) — the console asks for a second factor and retries once
  As a Tube administrator whose session has no fresh second factor
  I want the console to ask me for it instead of failing
  So a privileged action succeeds after I confirm, and not before

  Scenario: a ban refused with the step-up signal shows the challenge, then retries once
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses the first ban with the gateway step-up signal and then bans any user
    And the platform BFF accepts any 6-digit second-factor code
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    And "admin" enters the access user subject "google:spammer@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the step-up dialog fully inside the viewport
    And the tube-bff received 1 request to "POST /bff/tube/admin/access/ban"
    When "admin" enters the step-up code "123456" and verifies
    Then "admin" sees the access change result for "google:spammer@gmail.com"
    And the tube-bff received 2 requests to "POST /bff/tube/admin/access/ban"
    And the tube-bff received 1 request to "POST /bff/mfa/challenge"
    And the request body sent to "POST /bff/mfa/challenge" had "factor" equal to "totp"
    And "admin" no longer sees the step-up dialog

  Scenario: a dismissed challenge sends no retry and says the check was not confirmed
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses the first ban with the gateway step-up signal and then bans any user
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    And "admin" enters the access user subject "google:spammer@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the step-up dialog fully inside the viewport
    When "admin" cancels the step-up dialog
    Then "admin" sees the access error containing "fresh security check"
    And the tube-bff received 1 request to "POST /bff/tube/admin/access/ban"
    And "admin" no longer sees the step-up dialog

  Scenario: a plain role denial is never offered a challenge
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses every access change with 403
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    And "admin" enters the access user subject "google:spammer@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the access error containing "your role does not permit"
    And "admin" no longer sees the step-up dialog
    And the tube-bff received 1 request to "POST /bff/tube/admin/access/ban"

  Scenario: a storage budget refused with the step-up signal is retried after the challenge
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses the first storage budget with the gateway step-up signal and then applies it with 2 GB used
    And the platform BFF accepts any 6-digit second-factor code
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "20" GB for "google:bob@gmail.com"
    Then "admin" sees the step-up dialog fully inside the viewport
    When "admin" enters the step-up code "654321" and verifies
    Then "admin" sees the budget row for "google:bob@gmail.com" reading "2.0 GB / 20.0 GB"
    And the tube-bff received 2 requests to "POST /bff/tube/admin/storage-budget"
