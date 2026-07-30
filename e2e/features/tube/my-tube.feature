# USER-SITUATIONAL coverage — the "My Tube" user console (the headline LocalTube
# surface: a user views their OWN subscribed-channel content). tubeReadGuard
# (TUBE_USE = ROLE_TUBE) admits a granted user; the console then shows their
# owner-scoped subscriptions, download queue, storage usage, the enqueue action,
# and in-platform viewing of their OWN completed downloads.
#
# ALLOW + DENY + disabled/helptext are all exercised:
#   - ALLOW         — a granted ROLE_TUBE user sees their subs/queue/usage and
#                     can load a completed video.
#   - default-deny  — a ROLE_TUBE user WITHOUT an active tube_access grant gets a
#                     403 from the BFF TubeAccessGuard → the access-not-granted
#                     panel (ROLE_TUBE is the floor, not a use grant).
#   - disabled+help — when the storage budget is full (queue has `skipped` jobs),
#                     the Enqueue button is DISABLED with the budget-full
#                     helptext (the canonical disabled+helptext case).
#   - DENY (boundary) — a plain user with no tube role is sent to /tube/forbidden
#                     (NOT /login: the host already authgated them into /tube).
#
# Markup under test: src/app/tube-my.component.html, tube-console.component.html,
# tube-forbidden.component.html.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @tube-ui @user-situational
Feature: My Tube — a user views and manages their own subscribed-channel downloads
  As a user granted the Tube service role
  I want to see my subscriptions, queue downloads, and watch my completed videos
  So I can use LocalTube within the platform

  Scenario: a granted Tube user sees only the My Tube nav item (role cascade)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees only the "my" nav item

  Scenario: a granted Tube user sees their own subscriptions, queue and usage (ALLOW)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list
    And "tube-user" sees their download queue
    And "tube-user" sees the storage usage bar
    And "tube-user" sees the enqueue action enabled

  Scenario: a granted Tube user can play their own completed download (in-platform viewing)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" can load the video for the completed download "job-own-done"

  Scenario: enqueueing from subscriptions adds a queued job and shows the success notice (ALLOW mutation)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    And "tube-user" enqueues from their subscriptions
    Then "tube-user" sees the enqueue success notice
    And "tube-user" sees a download job in state "queued"

  Scenario: enqueue is disabled with budget-full helptext when storage is full (disabled+helptext)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the enqueue action disabled with the budget-full helptext

  Scenario: a Tube user without an active use-grant sees the access-not-granted panel (default-deny)
    Given "tube-user-ungranted" is logged in
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees the access-not-granted panel

  Scenario: a plain user with no Tube role is sent to the forbidden boundary (DENY)
    Given "plain-user" is logged in
    When "plain-user" navigates to "/tube/my"
    Then "plain-user" is sent to the tube forbidden screen
    And "plain-user" does not see the back-to-my-tube link
