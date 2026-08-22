# Demo mode

Demo Mode is the only implemented AI mode. Scenarios are `NORMAL`, `EXIT_A_CONGESTION`, `EXIT_B_CONGESTION`, `RIPPLE_DETECTED`, `CRITICAL_STATE`, `RECOVERY`, `ZONE_CONGESTION`, `EXIT_CONGESTION`, and `MULTI_ZONE_EVENT`. They update typed zone/exit metrics, the decision and exit ranking, mock hardware state, risk history, intervention status, and persistent events.

The UI labels the provider as simulated. Scenario output must never be presented as trained-model or camera-derived measurement. To add a scenario, define its risk transition in `backend/service.py`, update metrics, and add a test for its decision and intervention outcome.
