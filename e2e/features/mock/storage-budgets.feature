# OFFLINE MOCKED-BACKEND lane — the Storage Budgets console.
#
# NOT @cluster: runs in the default lane against `ng serve tube` (mounted at
# /tube) with a seeded hug.session and page.route() standing in for the
# tube-bff. See tube-access.feature for the lane's contract and its limits — this
# proves what the console sends and renders, not that the bff authorises.
#
# Markup under test: src/app/tube-budgets.component.html, tube.guard.ts,
# format-bytes.ts.
@mock @tube-ui @user-situational
Feature: Storage Budgets console (mocked backend) — set a budget, see the usage
  As a Tube administrator
  I want to cap a user's download storage and see the result
  So a user cannot fill the disk, and I can tell how close they are

  Scenario: an admin sets 20 GB and the console sends bytes and shows used / budget
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff applies any storage budget with 5 GB already used
    When "admin" navigates to "/tube/budgets"
    Then "admin" sees no budgets listed yet
    When "admin" sets a budget of "20" GB for "google:alice@gmail.com"
    Then "admin" sees the applied budget row for "google:alice@gmail.com"
    And "admin" sees the budget row for "google:alice@gmail.com" reading "5.0 GB / 20.0 GB"
    And "admin" sees the budget usage bar for "google:alice@gmail.com" at 25 percent
    And the request body sent to "POST /bff/tube/admin/storage-budget" had "budgetBytes" equal to "21474836480"
    And the request body sent to "POST /bff/tube/admin/storage-budget" had "userSubject" equal to "google:alice@gmail.com"

  Scenario: a zero budget is accepted and shown as full
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff applies any storage budget with 1 GB already used
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "0" GB for "google:bob@gmail.com"
    Then "admin" sees the budget usage bar for "google:bob@gmail.com" at 100 percent
    And the request body sent to "POST /bff/tube/admin/storage-budget" had "budgetBytes" equal to "0"

  Scenario: a negative budget is refused client-side and nothing is sent
    Given "admin" has a seeded session
    And the tube-bff is mocked
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "-5" GB for "google:alice@gmail.com"
    Then "admin" sees the validation alert "Enter a non-negative budget."
    And "admin" sees no budgets listed yet
    And the tube-bff received 0 requests to "POST /bff/tube/admin/storage-budget"

  Scenario: an empty subject is refused client-side and nothing is sent
    Given "admin" has a seeded session
    And the tube-bff is mocked
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "10" GB for ""
    Then "admin" sees the validation alert "A user subject is required."
    And the tube-bff received 0 requests to "POST /bff/tube/admin/storage-budget"

  Scenario: a server 403 is shown as a role denial and no budget row appears
    Given "admin" has a seeded session
    And the tube-bff is mocked
    And the tube-bff refuses every storage budget with 403
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "20" GB for "google:alice@gmail.com"
    Then "admin" sees the budget error containing "your role does not permit setting storage budgets"
    And "admin" sees no budgets listed yet

  Scenario: a granted Tube user is bounced from the Storage Budgets console
    Given "tube-user" has a seeded session
    And the tube-bff is mocked
    When "tube-user" navigates to "/tube/budgets"
    Then "tube-user" is sent to the tube forbidden screen
    And "tube-user" sees the back-to-my-tube link
    And "tube-user" does not see the "budgets" nav item

  Scenario: a user with no Tube role is bounced and offered no way back
    Given "plain-user" has a seeded session
    And the tube-bff is mocked
    When "plain-user" navigates to "/tube/budgets"
    Then "plain-user" is sent to the tube forbidden screen
    And "plain-user" does not see the back-to-my-tube link
