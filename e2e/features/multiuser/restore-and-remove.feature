# MULTIUSER-SITUATIONAL coverage — the two DELETE verbs on the Tube Access console
# (TubeService.revoke → DELETE /bff/tube/admin/access/{banned|use}/{user}), which
# had ZERO e2e. These are also the only CLEANUP paths, so each scenario undoes its
# own write and leaves the shared stack in its baseline state (tube-user granted,
# tube-user-ungranted ungranted) — the order-independence the existing grant→ban
# suite lacks.
#
# Two round trips, both with the victim live in their own context:
#   - RESTORE a ban   — a banned user is re-denied My Tube; the admin lifts the ban
#                       from the result panel; the user regains My Tube.
#   - REMOVE a grant  — a granted user reaches My Tube; the admin removes the grant
#                       from the result panel; the user drops back to the denied panel.
#
# @cluster — the ban/grant + DELETE mutations need the live tube-bff.
@cluster @tube-ui @multiuser
Feature: Restore a ban and remove a grant — the Tube Access DELETE round trips
  As a Tube admin acting on a live user
  I want to lift a ban and remove a grant from the result panel
  So the reversible access verbs are proven end-to-end across both consoles

  Scenario: restoring a ban re-admits the user to My Tube
    Given "admin" is logged in in their own context
    And "tube-user" is logged in in their own context
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    And "admin" enters the access user subject "google:tube-user@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user@example.test"
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the access-not-granted panel
    When "admin" restores the ban from the result panel
    Then "admin" sees the access notice containing "Tube use restored"
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list

  Scenario: removing a grant drops the user back to the access-not-granted panel
    Given "admin" is logged in in their own context
    And "tube-user-ungranted" is logged in in their own context
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees the access-not-granted panel
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:tube-user-ungranted@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user-ungranted@example.test"
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees their subscribed channels list
    When "admin" removes the grant from the result panel
    Then "admin" sees the access notice containing "Use grant removed"
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees the access-not-granted panel
