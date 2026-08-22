# AI integration

Current values come only from `MockAIProvider` and are marked simulated. Place future model artifacts under `backend/ai/models/`; do not commit large or licensed weights without review.

A provider implements `predict(facility)`, `get_zone_metrics(facility)`, and `get_health()`, returning typed `AIPrediction` and `ZoneMetrics`. A Teachable Machine export may be Keras, TFLite, TensorFlow.js, or another format; load it only inside its provider. Convert classifier probabilities into scientifically responsible CrowdState values using documented, tested thresholds.

Future OpenCV/YOLO/ByteTrack analysis can contribute people count, density, speed, direction conflict, inflow/outflow, queue growth, stopped percentage, and ripple score. Provider fusion should combine features with provenance and confidence; cross-camera person re-identification is deliberately out of scope.
