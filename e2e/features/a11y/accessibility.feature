# Accessibility coverage — the org a11y standard the tube-ui carries: a skip link
# that moves focus to the main region, a named menubar landmark, roving tabindex
# along the nav items, aria-current on the active item, the labelled
# storage-usage progressbar, announced loading/access states, and focus
# restoration after a route change.
#
# Markup under test (tube-ui src):
#   app.component.html           — `<a class="skip" href="#tube-main">` +
#                                  `<main id="tube-main" tabindex="-1">`.
#   tube-console.component.html  — `<nav role="menubar" aria-label="Tube console">`
#                                  + roving-tabindex items (data-testid=tube-nav-*)
#                                  with aria-label + aria-describedby help and
#                                  ariaCurrentWhenActive="page".
#   tube-my.component.html       — role="progressbar" usage bar; role="status"
#                                  access-denied panel.
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
@cluster @tube-ui @a11y
Feature: tube-ui accessibility — skip link, named menubar, roving tabindex, progressbar
  As a keyboard / assistive-tech operator
  I want the Tube console to honour the org a11y standard
  So I can reach and operate every surface without a mouse

  Scenario: the skip link is the first tab stop and moves focus to main
    Given "tube-user" has a seeded session
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" can tab to the skip link
    And activating the skip link moves focus to the main region

  Scenario: the tube console menubar is a named landmark with described items
    Given "admin" has a seeded session
    When "admin" navigates to "/tube/my"
    Then the tube console menubar has an accessible name
    And each tube nav item carries an accessible name and help

  Scenario: arrow keys rove focus along the tube nav items
    Given "admin" has a seeded session
    When "admin" navigates to "/tube/my"
    And "admin" focuses the first tube nav item
    Then arrow-key navigation moves focus along the tube nav items

  Scenario: the active nav item is marked as the current page
    Given "tube-user" has a seeded session
    When "tube-user" navigates to "/tube/my"
    Then the "my" active nav item is marked as the current page

  Scenario: the storage usage bar is a labelled progressbar
    Given "tube-user" has a seeded session
    When "tube-user" navigates to "/tube/my"
    Then the storage usage bar is a labelled progressbar

  Scenario: the access-not-granted panel is announced as a status region
    Given "tube-user-ungranted" has a seeded session
    When "tube-user-ungranted" navigates to "/tube/my"
    Then the "tube-my-access-denied" state is announced via role "status"

  Scenario: focus returns to the main region after a route change
    Given "admin" has a seeded session
    When "admin" navigates to "/tube/budgets"
    Then "admin" sees the "tube-budgets-title" view
    And focus is restored to the main region after navigation
