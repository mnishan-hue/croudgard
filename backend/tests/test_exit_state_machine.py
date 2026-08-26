from backend.decision import DecisionEngine
from backend.hardware.esp32_client import compute_hardware_state
from backend.models import Exit, Zone, ZoneMetrics


def scenario(main: float, exit_a: float, exit_b: float):
    zones = [
        Zone(id="zone_main", facility_id="facility", name="Main", risk=main),
        Zone(
            id="zone_exit_a",
            facility_id="facility",
            name="Exit A",
            risk=exit_a,
            metrics=ZoneMetrics(people_count=round(exit_a / 4), density=exit_a),
        ),
        Zone(
            id="zone_exit_b",
            facility_id="facility",
            name="Exit B",
            risk=exit_b,
            metrics=ZoneMetrics(people_count=round(exit_b / 4), density=exit_b),
        ),
    ]
    exits = [
        Exit(
            id="exit_a",
            facility_id="facility",
            name="Exit A",
            zone_id="zone_exit_a",
            risk=exit_a,
        ),
        Exit(
            id="exit_b",
            facility_id="facility",
            name="Exit B",
            zone_id="zone_exit_b",
            risk=exit_b,
        ),
    ]
    return zones, exits


def test_clear_exits_stay_normal_even_when_main_area_is_busy():
    decision = DecisionEngine().decide(*scenario(main=90, exit_a=18, exit_b=22))
    assert decision.action == "NORMAL"
    assert decision.recommended_exit_id is None
    assert compute_hardware_state(decision.action, None).display_message == (
        "THANK YOU VISIT AGAIN"
    )


def test_each_crowded_exit_redirects_to_the_clear_exit():
    engine = DecisionEngine()
    to_b = engine.decide(*scenario(main=60, exit_a=65, exit_b=18))
    assert to_b.action == "REDIRECT_TO_EXIT"
    assert to_b.recommended_exit_id == "exit_b"
    assert compute_hardware_state(to_b.action, to_b.recommended_exit_id).display_message == (
        "PLEASE USE EXIT B"
    )

    engine.reset_state()
    to_a = engine.decide(*scenario(main=60, exit_a=16, exit_b=68))
    assert to_a.action == "REDIRECT_TO_EXIT"
    assert to_a.recommended_exit_id == "exit_a"
    assert compute_hardware_state(to_a.action, to_a.recommended_exit_id).display_message == (
        "PLEASE USE EXIT A"
    )


def test_both_heavily_crowded_produces_slow_walking_message():
    decision = DecisionEngine().decide(*scenario(main=88, exit_a=76, exit_b=79))
    assert decision.action == "CRITICAL"
    assert decision.recommended_exit_id is None
    assert compute_hardware_state(decision.action, None).display_message == (
        "PLEASE WALK SLOWLY / MAINTAIN SPACE"
    )


def test_minor_live_reversal_does_not_flip_the_route(monkeypatch):
    clock = iter([100.0, 101.0, 109.0])
    monkeypatch.setattr("backend.decision.time.monotonic", lambda: next(clock))
    engine = DecisionEngine(min_dwell_seconds=8, switch_margin=10)

    first = engine.decide(*scenario(main=60, exit_a=58, exit_b=22))
    assert first.recommended_exit_id == "exit_b"

    noisy_reversal = engine.decide(*scenario(main=60, exit_a=32, exit_b=54))
    assert noisy_reversal.recommended_exit_id == "exit_b"

    confirmed_reversal = engine.decide(*scenario(main=60, exit_a=32, exit_b=54))
    assert confirmed_reversal.recommended_exit_id == "exit_a"


def test_dangerous_route_can_switch_immediately():
    engine = DecisionEngine(min_dwell_seconds=60, switch_margin=10)
    initial = engine.decide(*scenario(main=60, exit_a=58, exit_b=20))
    assert initial.recommended_exit_id == "exit_b"

    emergency = engine.decide(*scenario(main=82, exit_a=25, exit_b=82))
    assert emergency.recommended_exit_id == "exit_a"


def test_invalid_redirect_never_defaults_to_an_arbitrary_exit():
    try:
        compute_hardware_state("REDIRECT_TO_EXIT", None)
    except ValueError as error:
        assert "require" in str(error).lower()
    else:
        raise AssertionError("Redirect without a valid exit must fail")


def test_no_usable_exit_never_reports_that_exits_are_free():
    zones, exits = scenario(main=80, exit_a=20, exit_b=20)
    for exit_ in exits:
        exit_.status = "CLOSED"
    decision = DecisionEngine().decide(zones, exits)
    assert decision.action == "CRITICAL"
    assert decision.recommended_exit_id is None
    assert "no usable exit" in decision.reason.lower()


def test_only_congested_usable_exit_uses_cautious_response():
    zones, exits = scenario(main=70, exit_a=55, exit_b=10)
    exits[1].status = "CLOSED"
    decision = DecisionEngine().decide(zones, exits)
    assert decision.action == "CRITICAL"
    assert decision.recommended_exit_id is None
    assert "only usable exit" in decision.reason.lower()