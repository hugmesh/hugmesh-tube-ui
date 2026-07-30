# MULTIUSER-SITUATIONAL coverage — the storage-budget's EFFECT on the target user,
# not just the admin-side echo. The existing suite only asserts the admin sees an
# "applied row" (a client-local echo of the POST); nothing proves the change reaches
# the user. This drives the full cross-user journey and, in doing so, flushes out the
# rendering trap the audit flagged: budgetFull() derives from stale `skipped` jobs, so
# if the BFF does NOT reflow skipped work on a budget raise the user stays locked out
# after the raise — this scenario would then fail, surfacing that stuck state.
#
# Journey: admin caps the user at 0 GB → the user's enqueue is paused (skipped) →
# enqueue is disabled with the budget-full help-text → admin raises the budget →
# the user can enqueue again and a queued job appears.
#
# @cluster — the budget writes + the enqueue pause/queue transitions need the live
# tube-bff (and the target user must have subscriptions to enqueue from).
@cluster @tube-ui @multiuser
Feature: Raising a full storage budget unblocks a budget-full user
  As a Tube admin and a Tube user together
  I want raising a user's storage budget to let them enqueue downloads again
  So a budget-full user is genuinely unblocked, not just echoed to the admin

  Scenario: a user capped at zero is unblocked once the admin raises their budget
    Given "admin" is logged in in their own context
    And "tube-user" is logged in in their own context
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "0" GB for "google:tube-user@example.test"
    Then "admin" sees the applied budget row for "google:tube-user@example.test"
    When "tube-user" navigates to "/tube/my"
    And "tube-user" enqueues from their subscriptions
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the enqueue action disabled with the budget-full helptext
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "20" GB for "google:tube-user@example.test"
    Then "admin" sees the applied budget row for "google:tube-user@example.test"
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees the enqueue action enabled
    When "tube-user" enqueues from their subscriptions
    Then "tube-user" sees the enqueue success notice
    And "tube-user" sees a download job in state "queued"
