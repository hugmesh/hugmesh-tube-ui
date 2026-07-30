# USER-PREFERENCE coverage — the Google account panel on My Tube
# (src/app/tube-my.component.html #tube-google), the ONLY user-owned preference on
# the Tube surface, previously with ZERO e2e. The panel's meaningful states are the
# component's REACTION to specific BFF envelopes, so each scenario serves that exact
# envelope via Playwright route interception (a SEEDED session — pure client-side
# rendering, no real write — per the e2e honesty rule) and asserts the honest
# disclosure the component makes:
#   - degraded         — the status read FAILED → disclose the real failure and
#                        DISABLE connect/sync (never guess "not connected").
#   - reauth-required  — connected but the stored credential is known-bad → sync
#                        disabled with help-text + a Reconnect button.
#   - no consent URL   — /authorize returns no URL → disclose it, do NOT navigate.
#   - connect          — /authorize returns a URL → full-page navigation to it.
#   - disconnect       — POST /disconnect flips the panel back to the connect offer.
#   - sync             — POST /subscriptions/sync populates the channel list + notice.
#
# @cluster — this harness has no offline app server, so the served remote shell is
# still required; the interception replaces the tube-bff (no live tube-bff needed).
@cluster @tube-ui @user-preference
Feature: My Tube Google account panel — connect, degraded disclosure, reauth, disconnect, sync
  As a Tube user
  I want to connect, sync and disconnect my Google account with honest status disclosure
  So my only self-owned Tube preference behaves correctly in every backend state

  Scenario: the panel goes degraded and disables controls when the status read fails
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google connection status is unavailable
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the Google degraded disclosure

  Scenario: a not-connected account offers Connect Google
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account is not connected
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the Google connect action offered

  Scenario: a reauth-required account disables sync and offers Reconnect
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account needs re-authentication
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the Google reauth-required notice

  Scenario: clicking Connect with no consent URL discloses the failure and does not navigate
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account is not connected
    And the Google authorize endpoint returns no consent URL
    When "tube-user" navigates to "/tube/my"
    And "tube-user" clicks Connect Google
    Then "tube-user" sees the no-consent-URL disclosure

  Scenario: clicking Connect with a consent URL full-page-navigates to it (the OAuth hop)
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account is not connected
    And the Google authorize endpoint offers the consent path "/__google_consent_stub"
    When "tube-user" navigates to "/tube/my"
    And "tube-user" clicks Connect Google
    Then "tube-user" is taken to the Google consent page at "/__google_consent_stub"

  Scenario: disconnecting a connected account returns the panel to the connect offer
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account is connected
    And the Google disconnect endpoint reports disconnected
    When "tube-user" navigates to "/tube/my"
    And "tube-user" clicks Disconnect Google
    Then "tube-user" sees the My Tube notice containing "Google account disconnected"
    And "tube-user" sees the Google connect action offered

  Scenario: syncing subscriptions populates the channel list and shows the synced-count notice
    Given "tube-user" has a seeded session
    And the Google-connect BFF is stubbed
    And the Google account is connected
    And the subscription sync endpoint will report 1 synced channels for "chan-synced-1"
    When "tube-user" navigates to "/tube/my"
    And "tube-user" clicks Sync subscriptions
    Then "tube-user" sees the sync success notice for 1 channels
    And "tube-user" sees the synced channel "chan-synced-1"
