# FEATURE-GATING coverage — LocalTube is an OPTIONAL service. When it is ABSENT
# (the brand has not enabled the tube optional service), the host does not mount
# /tube at all and route-access carries no ROLE_TUBE, so the federated remote is
# unreachable. The platform-capability-gating standard requires infra-dependent
# features to be reflected as unavailable (greyed-out, "not possible without
# that") rather than silently 404-ing.
#
# Two gating layers:
#   1. SERVICE-ABSENT  — the tube optional service is not enabled for the brand;
#      the host's nav shows the Tube entry greyed-out / degraded (no live mount).
#      This is the host-shell concern, exercised here as a documented @cluster
#      scenario keyed off the host's degraded-service marker.
#   2. ROLE-ABSENT     — the service IS up but the user lacks ROLE_TUBE; the host
#      authgate keeps them out of /tube and, if they reach the remote, the
#      My-Tube read guard sends them to /tube/forbidden (covered in my-tube.feature).
#
# @cluster — ships dark; config filters `not @cluster` so no live stack is needed.
# The host degraded-service marker is a host-shell contract (a later wave wires
# the live assertion); this feature pins the EXPECTED behaviour now.
@cluster @tube-ui @feature-gated
Feature: Tube optional-service gating — degrade gracefully when LocalTube is absent
  As the platform host
  I want the Tube entry to reflect when the optional service is not enabled
  So a user is told it is unavailable rather than hitting a dead route

  Scenario: with the Tube service enabled, a granted user reaches the My Tube console
    Given "tube-user" is logged in
    When "tube-user" navigates to "/tube/my"
    Then "tube-user" sees their subscribed channels list

  Scenario: a user reaching the remote without the Tube role lands on the boundary screen
    Given "plain-user" is logged in
    When "plain-user" navigates to "/tube"
    Then "plain-user" is sent to the tube forbidden screen
