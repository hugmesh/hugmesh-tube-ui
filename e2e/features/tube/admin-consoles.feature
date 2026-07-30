# USER-SITUATIONAL coverage — the admin-gated Tube consoles (the role cascade's
# upper tiers). tubeManageGuard (TUBE_MANAGE = ADMIN|SUPERADMIN) gates BOTH the
# "Tube Access" grant/timeout/ban console and the "Storage Budgets" console; a
# plain ROLE_TUBE user (who CAN reach My Tube) is bounced from these to
# /tube/forbidden. The SUPERADMIN additionally sees the manage-all list/history
# panel (canManageAll); an ADMIN sees only the write form.
#
# This is the role-cascade ALLOW/DENY matrix:
#   superadmin → My Tube + Tube Access (+ manage-all panel) + Storage Budgets
#   admin      → My Tube + Tube Access (NO manage-all panel)   + Storage Budgets
#   tube-user  → My Tube only; Tube Access / Storage Budgets → /tube/forbidden
#
# Markup under test: src/app/tube-access.component.html,
# tube-budgets.component.html, tube-console.component.html.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @tube-ui @user-situational
Feature: Tube admin consoles — grant/ban and storage budgets gated to admin/superadmin
  As a Tube administrator
  I want to grant or ban Tube use and set per-user storage budgets
  So I can govern who uses LocalTube and how much they can store

  Scenario: an admin sees the manage nav items alongside My Tube (role cascade)
    Given "admin" is logged in
    When "admin" navigates to "/tube/my"
    Then "admin" sees the "my" nav item
    And "admin" sees the "access" nav item
    And "admin" sees the "budgets" nav item

  Scenario: an admin grants Tube use to a user (ALLOW)
    Given "admin" is logged in
    When "admin" navigates to "/tube/access"
    And "admin" selects the "grant" access action
    And "admin" enters the access user subject "google:newuser@gmail.com"
    And "admin" applies the access change
    Then "admin" sees the access change result for "google:newuser@gmail.com"

  Scenario: the ban action shows the precedence note (ban > grant)
    Given "admin" is logged in
    When "admin" navigates to "/tube/access"
    And "admin" selects the "ban" access action
    Then "admin" sees the ban-precedence note

  Scenario: an admin does NOT see the superadmin-only manage-all panel (tier boundary)
    Given "admin" is logged in
    When "admin" navigates to "/tube/access"
    Then "admin" does not see the manage-all overrides panel

  Scenario: a superadmin sees the manage-all overrides panel (superadmin ALLOW)
    Given "superadmin" is logged in
    When "superadmin" navigates to "/tube/access"
    Then "superadmin" sees the manage-all overrides panel

  Scenario: an admin sets a per-user storage budget (ALLOW)
    Given "admin" is logged in
    When "admin" navigates to "/tube/budgets"
    And "admin" sets a budget of "20" GB for "google:alice@gmail.com"
    Then "admin" sees the applied budget row for "google:alice@gmail.com"

  Scenario: a granted Tube user is bounced from the Tube Access console (DENY)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/access"
    Then "tube-user" is sent to the tube forbidden screen
    And "tube-user" sees the back-to-my-tube link

  Scenario: a granted Tube user is bounced from the Storage Budgets console (DENY)
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/budgets"
    Then "tube-user" is sent to the tube forbidden screen
    And "tube-user" sees the back-to-my-tube link
