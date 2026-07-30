# CROSS-USER ISOLATION coverage — the media-sign owner wall strengthened to
# VICTIM-CREATES-FIRST. The existing isolation.feature asserts the owner wall with a
# HARD-CODED victim path, so the 403 would pass even if that content never existed.
# Here the victim reads a REAL contentPath off their OWN owner-scoped queue and the
# attacker signs THAT exact path — so the 403 proves the owner wall, not merely that
# a fabricated path is rejected.
#
# @cluster — needs the live tube-bff (real queue rows + the media-sign owner check)
# and real per-user sessions for the credentialed cross-user fetch.
@cluster @tube-ui @cross-user
Feature: Cross-user media owner wall — victim-created content (no hard-coded path)
  As the Tube platform
  I must reject a user signing another user's REAL media contentPath
  So the owner wall holds against a path that genuinely exists for its owner

  Scenario: a second user cannot sign the first user's real media contentPath (owner wall, 403)
    Given "tube-user" is logged in in their own context
    And "tube-user-2" is logged in in their own context
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list
    When "tube-user" reads a media contentPath from their own download queue
    And "tube-user-2" tries to sign the captured contentPath
    Then the response status is 403
