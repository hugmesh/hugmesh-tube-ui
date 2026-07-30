# CROSS-USER ISOLATION coverage — a user may only ever see and act on their OWN
# tube data. Two identities coexist in one scenario (each in its own context) so
# the isolation is asserted with both users live, not by swapping one session.
#
# The two walls:
#   1. CONSOLE wall — a granted ROLE_TUBE user is DENIED the admin manage consoles
#      (Tube Access / Storage Budgets) → /tube/forbidden, while an admin reaches
#      them. The display gate is backed by the BFF: a USER calling an /admin/**
#      or /superadmin/** endpoint gets 403.
#   2. OWNER (media-sign) wall — the most important tube isolation. The My Tube
#      player only ever signs a contentPath from the caller's OWN owner-scoped
#      queue; the BFF re-checks the path embeds the caller's own /<domain>/<subject>/
#      prefix and 403s a cross-user path. So tube-user-2 cannot sign tube-user's
#      contentPath even with a valid token. Asserted at the API layer.
#
# The display-layer DENY is backed by an API-layer DENY (fail-closed) even if the
# UI were bypassed.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @tube-ui @cross-user
Feature: Cross-user isolation — own-data-only across the Tube consoles and media wall
  As the Tube platform
  I must isolate each user's subscriptions, queue and media from every other user
  So a granted token cannot read or act on another user's Tube data

  Scenario: a granted user is denied the admin consoles while an admin is allowed (console wall)
    Given "admin" has a seeded session in their own context
    And "tube-user" has a seeded session in their own context
    When "tube-user" navigates to "/tube/access"
    Then "tube-user" is sent to the tube forbidden screen
    When "admin" navigates to "/tube/access"
    Then "admin" sees the "tube-access-title" view

  Scenario: a granted user cannot reach the admin storage-budget endpoint via the BFF (403)
    Given "admin" has a seeded session in their own context
    And "tube-user" has a seeded session in their own context
    When "tube-user" POSTs to "/bff/tube/admin/storage-budget"
    Then the response status is 403

  Scenario: a granted user cannot reach the superadmin manage-all endpoint via the BFF (403)
    Given "tube-user" has a seeded session in their own context
    When "tube-user" GETs "/bff/tube/superadmin/access"
    Then the response status is 403

  Scenario: a domain admin cannot reach the superadmin manage-all endpoint via the BFF (403)
    Given "admin" has a seeded session in their own context
    When "admin" GETs "/bff/tube/superadmin/access"
    Then the response status is 403

  Scenario: a user cannot sign another user's media contentPath (owner wall, 403)
    Given "tube-user" has a seeded session in their own context
    And "tube-user-2" has a seeded session in their own context
    When "tube-user-2" GETs "/bff/tube/media/sign?path=%2Fdomain-a%2Fgoogle%3Atube-user%40example.test%2Fvid.mp4"
    Then the response status is 403

  Scenario: an unauthenticated client is rejected by the user download surface (401)
    Given a clean session
    When the unauthenticated client GETs "/bff/tube/downloads"
    Then the response status is 401
