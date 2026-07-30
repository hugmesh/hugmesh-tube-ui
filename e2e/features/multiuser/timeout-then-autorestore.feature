# MULTIUSER-SITUATIONAL coverage — the TIMEOUT verb, the one access action with a
# time dimension. Timeout was the only access verb with ZERO e2e (only grant + ban
# were exercised). Two roles over one lifecycle, both live in their own contexts.
#
# Two legs of the lifecycle:
#   1. DENY-IN-WINDOW (console form): an admin times a granted user out via the
#      Tube Access console; the result row reports accessType 'banned' WITH a future
#      expiry (the BFF models a timeout as a bounded ban), and the user is re-denied
#      the My Tube console while the window holds.
#   2. AUTO-RESTORE (short TTL): the console form only allows whole-hour timeouts
#      (which cannot auto-restore inside a test), so the auto-restore leg drives a
#      SHORT ttlSeconds directly against the real BFF endpoint with the admin's
#      authenticated context, then bounded-POLLS the user's My Tube until access is
#      restored on expiry — no fixed sleep, a real deadline.
#      The TTL must be long enough that the IN-WINDOW deny assertion (a full
#      federated navigation + remote bootstrap + BFF read on the victim's context)
#      lands before the window closes — otherwise the deny leg fails for a timing
#      reason, not a behavioural one. 20s covers that comfortably and still leaves
#      the restore inside the poll deadline below.
#
# @cluster — the grant/timeout mutations + auto-restore need the live tube-bff.
@cluster @tube-ui @multiuser
Feature: Tube timeout lifecycle — denied for the window, auto-restored on expiry
  As a Tube admin and a Tube user together
  I want a timeout to bound a user's Tube access and auto-restore when it expires
  So the timed-out user is re-denied during the window and re-admitted afterwards

  Scenario: an admin times a granted user out and the user is denied for the window
    Given "admin" is logged in in their own context
    And "tube-user" is logged in in their own context
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list
    When "admin" navigates to "/tube/access"
    And "admin" selects the "timeout" access action
    And "admin" enters the access user subject "google:tube-user@example.test"
    And "admin" sets the timeout duration to "24" hours
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user@example.test"
    And "admin" sees the access result of type "banned" with a future expiry
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the access-not-granted panel
    # Cleanup so the suite stays order-independent on a shared stack: lift the timeout.
    When "admin" restores the ban from the result panel
    Then "admin" sees the access notice containing "Tube use restored"

  Scenario: a short timeout auto-restores the user's access on expiry
    Given "admin" is logged in in their own context
    And "tube-user-ungranted" is logged in in their own context
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:tube-user-ungranted@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user-ungranted@example.test"
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees their subscribed channels list
    When "admin" times out "google:tube-user-ungranted@example.test" for 20 seconds via the BFF
    Then the response status is 200
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees the access-not-granted panel
    Then "tube-user-ungranted" regains My Tube access within 40 seconds
    # Cleanup: remove the grant so the user returns to the default-deny baseline.
    When "admin" removes the grant from the result panel
    Then "admin" sees the access notice containing "Use grant removed"
