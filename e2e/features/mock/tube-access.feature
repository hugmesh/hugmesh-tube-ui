# OFFLINE MOCKED-BACKEND lane — the Tube Access console (grant / timeout / ban /
# restore, plus the superadmin-only manage-all panel).
#
# NOT @cluster. These run in the default lane (`not @cluster`) against the
# standalone dev shell (`ng serve tube`, mounted at /tube) with:
#   - a seeded hug.session (no Casdoor round-trip), and
#   - page.route() answering /bff/tube/** in the exact wire shapes the tube-bff
#     emits (see features/steps/mock-steps.ts). Any /bff/ call a scenario did not
#     mock answers 501, so nothing passes by accident.
# What this proves: the CONSOLE's behaviour — what it sends, what it renders, how
# it degrades on a 403 — NOT that the tube-bff authorises correctly. The
# server-side role/ban/owner-wall guarantees stay in the @cluster features.
#
# Markup under test: src/app/tube-access.component.html, tube.guard.ts.
@mock @tube-ui @user-situational
Feature: Tube Access console (mocked backend) — what an admin can send and see
  As a Tube administrator
  I want the access console to send exactly what I entered and show the outcome
  So I can govern who uses LocalTube, even before a live stack is available

  Scenario: an admin grants use and the console sends the grant and shows the row
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff grants use to any user
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:newuser@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:newuser@gmail.com"
    And the tube-bff received 1 request to "POST /bff/tube/admin/access/grant"
    And the request body sent to "POST /bff/tube/admin/access/grant" had "userSubject" equal to "google:newuser@gmail.com"

  Scenario: a timeout is sent as whole seconds and reported as a bounded ban
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff times out any user
    When "admin" navigates to "/tube/access"
    And "admin" selects the "timeout" access action
    And "admin" enters the access user subject "google:noisy@gmail.com"
    And "admin" sets the timeout duration to "2" hours
    And "admin" applies the access change
    Then "admin" sees the access result of type "banned" with a future expiry
    And the request body sent to "POST /bff/tube/admin/access/timeout" had "ttlSeconds" equal to "7200"

  Scenario: a ban shows the precedence note and lifting it round-trips a DELETE
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff bans any user
    And the tube-bff lifts bans and removes grants
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    Then "admin" sees the ban-precedence note
    When "admin" enters the access user subject "google:spammer@gmail.com"
    And "admin" applies the access change
    And "admin" restores the ban from the result panel
    Then "admin" sees the access notice containing "Ban lifted for google:spammer@gmail.com"
    And the tube-bff received 1 request to "DELETE /bff/tube/admin/access/banned/google%3Aspammer%40gmail.com"

  Scenario: an empty subject is refused client-side and nothing is sent
    Given "admin" has a seeded session
    And the tube-bff is mocked
    When "admin" navigates to "/tube/access"
    And "admin" applies the access change
    Then "admin" sees the validation alert "A user subject is required."
    And "admin" sees no access change result
    And the tube-bff received 0 requests to "POST /bff/tube/admin/access/grant"

  Scenario: a server 403 is shown as a role denial, not a crash or a fake success
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses every access change with 403
    When "admin" navigates to "/tube/access"
    And "admin" enters the access user subject "google:newuser@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the access error containing "your role does not permit managing Tube access"
    And "admin" sees no access change result

  Scenario: an admin does not get the superadmin manage-all panel and no list call is made
    Given "admin" has a seeded session
    And the tube-bff is mocked
    When "admin" navigates to "/tube/access"
    Then "admin" does not see the manage-all overrides panel
    And the tube-bff received 0 requests to "GET /bff/tube/superadmin/access"

  Scenario: a superadmin sees the manage-all panel populated from the list endpoint
    Given "superadmin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff lists the active overrides "google:banned1@gmail.com, google:banned2@gmail.com"
    When "superadmin" navigates to "/tube/access"
    Then "superadmin" sees the manage-all overrides panel
    And "superadmin" sees the active override row for "google:banned1@gmail.com"
    And "superadmin" sees the active override row for "google:banned2@gmail.com"

  Scenario: a superadmin loads a user's access history
    Given "superadmin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff has no active overrides
    And the tube-bff serves access history for "google:alice@gmail.com"
    When "superadmin" navigates to "/tube/access"
    And "superadmin" loads the access history for "google:alice@gmail.com"
    Then "superadmin" sees a non-empty access history

  Scenario: a granted Tube user is bounced from the Tube Access console
    Given "tube-user" has a seeded session
    And the tube-bff is mocked
    When "tube-user" navigates to "/tube/access"
    Then "tube-user" is sent to the tube forbidden screen
    And "tube-user" sees the back-to-my-tube link
    And "tube-user" does not see the "access" nav item
