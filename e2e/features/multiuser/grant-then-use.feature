# MULTIUSER-SITUATIONAL coverage — two roles acting over the SAME tube lifecycle:
# an admin lifts a user above the default-deny use floor (grant), then the user
# can use Tube; the admin can also ban the user (ban > grant) which re-denies
# them. Two identities coexist in one scenario (each in its own context) so the
# interaction is asserted with both users live, not by swapping a single session.
#
# The display-layer outcome is backed by the BFF lifecycle:
#   - before a grant: the user's My Tube shows the access-not-granted panel (403).
#   - after a grant : the user's My Tube loads (subs/queue).
#   - after a ban   : the user is re-denied (403 → access-not-granted panel),
#     EVEN with an active grant (ban precedence).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed
# (the grant/ban mutations need the live tube-bff to flip the user's state).
@cluster @tube-ui @multiuser
Feature: Admin grants Tube use, the user then uses it (and a ban re-denies)
  As a Tube admin and a Tube user together
  I want a grant to lift the user above the default-deny floor and a ban to override it
  So the access overlay is enforced end-to-end across both consoles

  Scenario: an ungranted user is denied, the admin grants, then the user can use Tube
    Given "admin" has a seeded session in their own context
    And "tube-user-ungranted" has a seeded session in their own context
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees the access-not-granted panel
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:tube-user-ungranted@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user-ungranted@example.test"
    When "tube-user-ungranted" navigates to "/tube/my"
    Then "tube-user-ungranted" sees their subscribed channels list

  Scenario: a ban overrides an active grant and re-denies the user (ban precedence)
    Given "admin" has a seeded session in their own context
    And "tube-user" has a seeded session in their own context
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    And "admin" enters the access user subject "google:tube-user@example.test"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:tube-user@example.test"
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the access-not-granted panel
