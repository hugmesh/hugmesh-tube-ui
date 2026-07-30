# MULTIUSER-SITUATIONAL coverage — the superadmin AUDIT surface as a DATA journey,
# not just a visibility check. The existing suite only asserts the manage-all panel
# is VISIBLE to a superadmin; nothing proves an admin's write actually SURFACES there.
#
# Cross-role write→read: an admin grants a user on the Tube Access console, then a
# superadmin (in their own context) sees that user in the Active-overrides list
# (tube-access-row-<subject>) and the Load-history view returns a non-empty trail —
# the only check that the promised audit trail is real. The admin removes the grant
# at the end so the shared stack returns to its baseline (order-independent).
#
# @cluster — the grant mutation + the superadmin list/history reads need the live
# tube-bff (and a superadmin session for /bff/tube/superadmin/**).
@cluster @tube-ui @multiuser
Feature: Admin writes surface in the superadmin audit trail (active list + history)
  As a Tube admin and a Tube superadmin together
  I want an admin's grant to appear in the superadmin active-overrides list and history
  So the promised audit trail is proven to actually surface the write

  Scenario: an admin grant appears in the superadmin active list and history
    Given "admin" is logged in in their own context
    And "superadmin" is logged in in their own context
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:tube-user-ungranted@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user-ungranted@example.test"
    When "superadmin" navigates to "/tube/access"
    And "superadmin" refreshes the active overrides
    Then "superadmin" sees the active override row for "google:tube-user-ungranted@example.test"
    When "superadmin" loads the access history for "google:tube-user-ungranted@example.test"
    Then "superadmin" sees a non-empty access history
    # Cleanup so the suite stays order-independent: remove the grant just made.
    When "admin" removes the grant from the result panel
    Then "admin" sees the access notice containing "Use grant removed"
