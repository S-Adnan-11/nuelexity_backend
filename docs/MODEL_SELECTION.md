# Model selection and attribution

`GET /models` returns the backend-approved catalogue, default and availability. Guests use the configured default; signed-in users can select an available approved model. The catalogue currently includes GPT-OSS 20B, GPT-OSS 120B and Qwen 3.8 27B (Preview). Availability can vary by provider and account.

In Groq mode, model discovery checks metadata; it does not establish generation permission. A provider failure does not trigger an automatic model fallback. Sources-only mode retrieves excerpts and does not run inference.

Selection is stored with the conversation and changes apply to subsequent requests. An in-flight request retains its original model choice. On success, the completion event and stored answer carry provider-confirmed attribution. Old answers without metadata remain unknown. Sources-only and no-sources answers carry no model attribution.

See the [API contract](API.md#model-catalogue-and-choice) for request shapes and [database guide](DATABASE.md#set-up-a-new-development-project) for the required migration. The app's model and quota checks run against fake provider fixtures in the normal test suite.
